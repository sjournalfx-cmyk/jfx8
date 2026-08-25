// Server-side cTrader harvester: authenticates a dedicated SERVICE account
// server-side and pulls trendbar history for every symbol, so end users never
// need to connect their own cTrader account to use the Backtest Lab.
//
// Pure helpers (decodeTrendbars / normalizeSymbol / mergeBars / capToNewest)
// live in harvestCore.mjs (plain ESM) so the Vite dev middleware can reuse
// them without a TS transform; this module re-exports and adds the typed
// WebSocket/network layer that runs on Vercel functions.
export {
  CTRADER_PRICE_SCALE,
  normalizeSymbol,
  decodeTrendbars,
  mergeBars,
  capToNewest,
} from './harvestCore.js';

import WebSocket from 'ws';
import { PT, WS_DEMO, WS_LIVE, mapTimeframeToCtraderPeriod } from './protoTypes.js';
import { decodeTrendbars as _decode } from './harvestCore.js';
void _decode; // keep tree-shakers honest about the re-export above

export interface Candle { time: number; open: number; high: number; low: number; close: number; }

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
      const pending = (ws as any).__pending as Map<string, any> | undefined;
      if (!pending) return;
      const clientMsgId: string | undefined = msg.clientMsgId;
      if (clientMsgId && pending.has(clientMsgId)) {
        const req = pending.get(clientMsgId);
        pending.delete(clientMsgId);
        clearTimeout(req.timer);
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
    let pending: Map<string, any> = (socket as any).__pending;
    if (!pending) { pending = new Map(); (socket as any).__pending = pending; }

    const clientMsgId = nextId();
    const timer = setTimeout(() => {
      pending.delete(clientMsgId);
      reject(new Error(`Request timed out (payloadType ${payloadType})`));
    }, timeoutMs);

    pending.set(clientMsgId, { resolve, reject, timer });
    socket.send(JSON.stringify({ clientMsgId, payloadType, payload }), (err) => {
      if (err) { clearTimeout(timer); pending.delete(clientMsgId); reject(err); }
    });
  });
}

/** Mint a short-lived access token from the service account refresh token.
 *  cTrader ROTATES the refresh token on every mint — callers must persist
 *  `refreshToken` from the result or the next run fails with ACCESS_DENIED. */
export async function mintAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken: string | null }> {
  const clientId = process.env.CTRADER_CLIENT_ID || '';
  const clientSecret = process.env.CTRADER_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('cTrader app credentials not configured');

  const res = await fetch('https://openapi.ctrader.com/apps/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error || data.description || `Token refresh failed (${res.status})`);
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in || 2628000), refreshToken: data.refresh_token || null };
}

/** Build a fully-authenticated session: token + socket + app/account auth. */
export async function createServiceSession(persist?: {
  loadRotatedToken: () => Promise<string | null>;
  saveRotatedToken: (token: string) => Promise<void>;
}): Promise<ServiceSession & { socket: WebSocket }> {
  let refreshToken = process.env.CTRADER_SERVICE_REFRESH_TOKEN || '';
  const accountId = Number(process.env.CTRADER_SERVICE_ACCOUNT_ID || 0);
  const isDemo = (process.env.CTRADER_SERVICE_IS_DEMO || 'true') !== 'false';
  if (!refreshToken || !accountId) {
    throw new Error('Service cTrader session not configured (CTRADER_SERVICE_REFRESH_TOKEN / CTRADER_SERVICE_ACCOUNT_ID)');
  }

  // Prefer the latest rotated token persisted by a previous run.
  if (persist) {
    try {
      const saved = await persist.loadRotatedToken();
      if (saved) refreshToken = saved;
    } catch { /* fall back to env token */ }
  }

  const minted = await mintAccessToken(refreshToken);
  if (minted.refreshToken && persist) {
    try { await persist.saveRotatedToken(minted.refreshToken); } catch (e: any) { console.error('[harvester] failed to persist rotated token:', e?.message || e); }
  }
  const session: ServiceSession = {
    accessToken: minted.accessToken,
    ctidTraderAccountId: accountId,
    isDemo,
    clientId: process.env.CTRADER_CLIENT_ID || '',
    clientSecret: process.env.CTRADER_CLIENT_SECRET || '',
  };

  const socket = await openSocket(session);
  await send(socket, PT.APPLICATION_AUTH_REQ, { clientId: session.clientId, clientSecret: session.clientSecret });
  await send(socket, PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken: session.accessToken });
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
  return _decode(res.trendbar || [], target.digits);
}

export function closeSession(session: { socket: WebSocket } | null) {
  try { session?.socket.close(); } catch { /* ignore */ }
}
