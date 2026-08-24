// Plain-ESM mirror of ctraderHarvester.ts's network layer for the Vite dev
// middleware (Node can't import .ts at runtime). Keep in sync with
// api/_lib/ctraderHarvester.ts — production Vercel functions use that file;
// this one is dev-only.
import WebSocket from 'ws';
import { PT, WS_DEMO, WS_LIVE, mapTimeframeToCtraderPeriod } from './protoTypes.mjs';
import { decodeTrendbars } from './harvestCore.mjs';

function nextId() {
  return `harvest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function openSocket(session) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(session.isDemo ? WS_DEMO : WS_LIVE);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error('cTrader WebSocket connection timeout'));
    }, 30000);

    ws.binaryType = 'nodebuffer';
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      const pending = ws.__pending;
      if (!pending) return;
      const clientMsgId = msg.clientMsgId;
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

function send(socket, payloadType, payload, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let pending = socket.__pending;
    if (!pending) { pending = new Map(); socket.__pending = pending; }

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

/** Mint a short-lived access token from the service account refresh token. */
export async function mintAccessToken(refreshToken) {
  const clientId = process.env.CTRADER_CLIENT_ID || '';
  const clientSecret = process.env.CTRADER_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('cTrader app credentials not configured');

  const res = await fetch('https://openapi.ctrader.com/apps/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error || `Token refresh failed (${res.status})`);
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in || 2628000) };
}

/** Mint a short-lived access token from the service account refresh token.
 *  cTrader ROTATES the refresh token on every mint, so `onRotate` must persist
 *  the new token (Supabase service_config) or the next run fails with
 *  ACCESS_DENIED. */
export async function createServiceSession(env = {}) {
  let refreshToken = env.refreshToken ?? '';
  const accountId = Number(env.accountId ?? 0);
  const isDemo = (env.isDemo ?? 'true') !== 'false';
  const clientId = env.clientId ?? '';
  const clientSecret = env.clientSecret ?? '';
  if (!refreshToken || !accountId) {
    throw new Error('Service cTrader session not configured (CTRADER_SERVICE_REFRESH_TOKEN / CTRADER_SERVICE_ACCOUNT_ID)');
  }

  // Prefer the latest rotated token persisted by a previous run.
  if (env.loadRotatedToken) {
    try {
      const saved = await env.loadRotatedToken();
      if (saved) refreshToken = saved;
    } catch { /* fall back to env token */ }
  }

  const mint = await mintAccessTokenWith(refreshToken, clientId, clientSecret);
  // Persist the rotation immediately — the old token is now invalid.
  if (mint.refreshToken && env.saveRotatedToken) {
    try { await env.saveRotatedToken(mint.refreshToken); } catch (e) { console.error('[harvester] failed to persist rotated token:', e?.message || e); }
  }
  const accessToken = mint.accessToken;
  const session = { accessToken, ctidTraderAccountId: accountId, isDemo, clientId, clientSecret };

  const socket = await openSocket(session);
  await send(socket, PT.APPLICATION_AUTH_REQ, { clientId, clientSecret });
  await send(socket, PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken });
  return { ...session, socket };
}

async function mintAccessTokenWith(refreshToken, clientId, clientSecret) {
  const res = await fetch('https://openapi.ctrader.com/apps/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error || data.description || `Token refresh failed (${res.status})`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token || null };
}

export async function listSymbols(session) {
  const data = await send(session.socket, PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: session.ctidTraderAccountId });
  return (data.symbol || [])
    .map((s) => ({
      symbolName: String(s.symbolName || s.name || ''),
      symbolId: Number(s.symbolId),
      digits: Number.isFinite(Number(s.digits)) ? Number(s.digits) : 5,
    }))
    .filter((t) => t.symbolName && t.symbolId > 0);
}

export async function fetchTrendbarsServer(session, target, timeframe, opts = {}) {
  const payload = {
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

export function closeSession(session) {
  try { session?.socket.close(); } catch { /* ignore */ }
}
