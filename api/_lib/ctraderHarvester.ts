// Server-side cTrader harvester: authenticates a dedicated SERVICE account
// server-side and pulls trendbar history for every symbol, so end users never
// need to connect their own cTrader account to use the Backtest Lab.
//
// Pure helpers (decodeTrendbars / normalizeSymbol / mergeBars) are unit-tested
// in test/ctraderHarvester.test.ts. The WebSocket/network layer mirrors the
// browser logic in services/ctraderService.ts but runs on Node's `ws`.
import WebSocket from 'ws';
import { PT, WS_DEMO, WS_LIVE, mapTimeframeToCtraderPeriod } from './protoTypes';

// ------------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------------

export interface RawTrendbar {
  utcTimestampInMinutes?: number | string;
  utcTimestamp?: number | string;
  timestamp?: number | string;
  low?: number | string;
  deltaOpen?: number | string;
  deltaHigh?: number | string;
  deltaClose?: number | string;
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

const CTRADER_PRICE_SCALE = 100000;

/** Normalize any broker symbol spelling (EURUSD / eur/usd / GBP_JPY) for matching. */
export function normalizeSymbol(name: string): string {
  return String(name || '').toUpperCase().replace(/[/_]/g, '');
}

/**
 * Decode ProtoOAGetTrendbarsRes trendbar entries into OHLC candles.
 * Prices arrive as integers scaled by 10^5; `low` is absolute while
 * open/high/close are deltas from it. `digits` only controls display rounding.
 */
export function decodeTrendbars(bars: RawTrendbar[], digits: number = 5): Candle[] {
  const candles: Candle[] = [];
  if (!Array.isArray(bars)) return candles;

  const round = (v: number) => Number(v.toFixed(digits));

  for (const bar of bars) {
    if (!bar || typeof bar !== 'object') continue;
    const low = Number(bar.low);
    const dOpen = Number(bar.deltaOpen);
    const dHigh = Number(bar.deltaHigh);
    const dClose = Number(bar.deltaClose);
    const tsMin = Number(bar.utcTimestampInMinutes);
    if (![low, dOpen, dHigh, dClose, tsMin].every(Number.isFinite)) continue;

    let timeInSeconds: number;
    if (Number.isFinite(tsMin) && tsMin > 0) {
      timeInSeconds = tsMin * 60;
    } else {
      const tsMs = Number(bar.utcTimestamp ?? bar.timestamp);
      timeInSeconds = Number.isFinite(tsMs) && tsMs > 0 ? Math.floor(tsMs / 1000) : Math.floor(Date.now() / 1000);
    }

    candles.push({
      time: timeInSeconds,
      open: round(low / CTRADER_PRICE_SCALE + dOpen / CTRADER_PRICE_SCALE),
      high: round(low / CTRADER_PRICE_SCALE + dHigh / CTRADER_PRICE_SCALE),
      low: round(low / CTRADER_PRICE_SCALE),
      close: round(low / CTRADER_PRICE_SCALE + dClose / CTRADER_PRICE_SCALE),
    });
  }

  return candles.sort((a, b) => a.time - b.time);
}

/**
 * Merge two bar lists by open time; on overlap the INCOMING bar wins.
 * Same semantics as lib/candleStore.mergeBars — duplicated here because api/
 * functions must not import from the Vite client bundle.
 */
export function mergeBars(existing: Candle[] | null, incoming: Candle[] | null): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const list of [existing, incoming]) {
    if (!Array.isArray(list)) continue;
    for (const bar of list) {
      if (bar && Number.isFinite(bar.time) && Number.isFinite(bar.open) &&
          Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close)) {
        byTime.set(bar.time, bar);
      }
    }
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

export function capToNewest(bars: Candle[], maxBars: number): Candle[] {
  return bars.length <= maxBars ? bars : bars.slice(-maxBars);
}

// ------------------------------------------------------------------
// Network layer
// ------------------------------------------------------------------

export interface ServiceSession {
  accessToken: string;
  ctidTraderAccountId: number;
  isDemo: boolean;
  clientId: string;
  clientSecret: string;
}

interface PendingReq { resolve: (v: any) => void; reject: (e: any) => void; }

function nextId(): string {
  return `harvest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function openSocket(session: ServiceSession): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(session.isDemo ? WS_DEMO : WS_LIVE);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error('cTrader WebSocket connection timeout'));
    }, 30000);

    ws.binaryType = 'nodebuffer';
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });

    ws.on('message', (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      const pending = (ws as any).__pending as Map<string, PendingReq> | undefined;
      if (!pending) return;
      const clientMsgId: string | undefined = msg.clientMsgId;
      if (clientMsgId && pending.has(clientMsgId)) {
        const req = pending.get(clientMsgId)!;
        pending.delete(clientMsgId);
        clearTimeout((req as any).timer);
        if (msg.payloadType === PT.ERROR_RES) {
          const code = msg.payload?.errorCode || 'cTrader error';
          req.reject(new Error(msg.payload?.description ? `${code}: ${msg.payload.description}` : String(code)));
        } else {
          req.resolve(msg.payload);
        }
      }
    });
  });
}

function send(socket: WebSocket, payloadType: number, payload: Record<string, any>, timeoutMs = 25000): Promise<any> {
  return new Promise((resolve, reject) => {
    let pending: Map<string, PendingReq> = (socket as any).__pending;
    if (!pending) { pending = new Map(); (socket as any).__pending = pending; }

    const clientMsgId = nextId();
    const timer = setTimeout(() => {
      pending.delete(clientMsgId);
      reject(new Error(`Request timed out (payloadType ${payloadType})`));
    }, timeoutMs);

    pending.set(clientMsgId, { resolve, reject } as PendingReq & { timer: NodeJS.Timeout });
    socket.send(JSON.stringify({ clientMsgId, payloadType, payload }), (err) => {
      if (err) { clearTimeout(timer); pending.delete(clientMsgId); reject(err); }
    });
  });
}

/** Mint a short-lived access token from the service account refresh token. */
export async function mintAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const clientId = process.env.CTRADER_CLIENT_ID || '';
  const clientSecret = process.env.CTRADER_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('cTrader app credentials not configured');

  const res = await fetch('https://openapi.ctrader.com/apps/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error || `Token refresh failed (${res.status})`);
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in || 2628000) };
}

/** Build a fully-authenticated session: token + socket + app/account auth. */
export async function createServiceSession(): Promise<ServiceSession & { socket: WebSocket }> {
  const refreshToken = process.env.CTRADER_SERVICE_REFRESH_TOKEN || '';
  const accountId = Number(process.env.CTRADER_SERVICE_ACCOUNT_ID || 0);
  const isDemo = (process.env.CTRADER_SERVICE_IS_DEMO || 'true') !== 'false';
  if (!refreshToken || !accountId) {
    throw new Error('Service cTrader session not configured (CTRADER_SERVICE_REFRESH_TOKEN / CTRADER_SERVICE_ACCOUNT_ID)');
  }

  const { accessToken } = await mintAccessToken(refreshToken);
  const session: ServiceSession = {
    accessToken,
    ctidTraderAccountId: accountId,
    isDemo,
    clientId: process.env.CTRADER_CLIENT_ID || '',
    clientSecret: process.env.CTRADER_CLIENT_SECRET || '',
  };

  const socket = await openSocket(session);
  await send(socket, PT.APPLICATION_AUTH_REQ, { clientId: session.clientId, clientSecret: session.clientSecret });
  await send(socket, PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken });
  return { ...session, socket };
}

export interface HarvestTarget { symbolName: string; symbolId: number; digits: number; }

/** List all tradeable symbols visible to the service account. */
export async function listSymbols(session: ServiceSession & { socket: WebSocket }): Promise<HarvestTarget[]> {
  const data = await send(session.socket, PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: session.ctidTraderAccountId });
  return (data.symbol || []).map((s: any) => ({
    symbolName: String(s.symbolName || s.name || ''),
    symbolId: Number(s.symbolId),
    digits: Number.isFinite(Number(s.digits)) ? Number(s.digits) : 5,
  })).filter((t: HarvestTarget) => t.symbolName && t.symbolId > 0);
}

/** Fetch recent trendbars for one symbol/timeframe. */
export async function fetchTrendbarsServer(
  session: ServiceSession & { socket: WebSocket },
  target: HarvestTarget,
  timeframe: string,
  opts: { fromTimestamp?: number; toTimestamp?: number; count?: number } = {}
): Promise<Candle[]> {
  const payload: Record<string, any> = {
    ctidTraderAccountId: session.ctidTraderAccountId,
    symbolId: target.symbolId,
    period: mapTimeframeToCtraderPeriod(timeframe),
  };
  if (opts.fromTimestamp) payload.fromTimestamp = opts.fromTimestamp;
  if (opts.toTimestamp) payload.toTimestamp = opts.toTimestamp;
  if (opts.count) payload.count = opts.count;

  const res = await send(session.socket, PT.GET_TRENDBARS_REQ, payload);
  return decodeTrendbars(res.trendbar || [], target.digits);
}

export function closeSession(session: { socket: WebSocket } | null) {
  try { session?.socket.close(); } catch { /* ignore */ }
}
