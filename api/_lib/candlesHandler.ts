import { requireUser } from './auth.js';
import {
  auditApiKeyCall,
  extractRawKey,
  JFX_PAT_PATTERN,
  resolveSymbolId,
  suggestSymbols,
  verifyApiKey,
} from './apiKeys.js';
import {
  loadUserCtraderAccessToken,
  openCtraderSession,
  parseIsDemo,
  type WsSession,
} from './ctraderSession.js';
import { resolvePortfolioContext } from './tradingLocks.js';

// Type-only: these handlers referenced Vercel types that were never declared,
// which failed `npm run lint` (tsc). No runtime change.
type VercelRequest = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type VercelResponse = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Live per-user OHLC candles for agents.
//
// GET /api/ctrader/candles?symbol=EURUSD&timeframe=H1&count=500&from=&to=&ctidTraderAccountId=&isDemo=
// Auth: X-API-Key: jfx_pat_... (needs trades:read) or Supabase session.
// Unlike GET /api/candles (shared harvested store, may lag), this reads
// ProtoOAGetTrendbars straight from the caller's own broker account, so it
// requires their cTrader to be connected.

const PT = {
  APPLICATION_AUTH_REQ: 2100,
  ACCOUNT_AUTH_REQ: 2102,
  SYMBOLS_LIST_REQ: 2114,
  GET_TRENDBARS_REQ: 2137,
  GET_ACCOUNTS_BY_TOKEN_REQ: 2149,
  ERROR_RES: 2142,
};

const TIMEFRAME_PERIODS: Record<string, number> = {
  M1: 1, M2: 2, M3: 3, M4: 4, M5: 5, M10: 6, M15: 7, M30: 8,
  H1: 9, H4: 10, D1: 11, W1: 12, MN1: 13,
};

const TIMEFRAME_ALIASES: Record<string, string> = {
  '1M': 'M1', '2M': 'M2', '3M': 'M3', '4M': 'M4', '5M': 'M5',
  '10M': 'M10', '15M': 'M15', '30M': 'M30',
  '1H': 'H1', '4H': 'H4', '1D': 'D1', '1W': 'W1', '1MN': 'MN1', MN: 'MN1',
};

export const ALLOWED_TIMEFRAMES = Object.keys(TIMEFRAME_PERIODS);

/** Canonical timeframe + cTrader period, or null when the value is unknown. */
function resolveTimeframe(raw: string): { timeframe: string; period: number } | null {
  const norm = String(raw || '').trim().toUpperCase();
  const canonical = TIMEFRAME_ALIASES[norm] || norm;
  const period = TIMEFRAME_PERIODS[canonical];
  return period ? { timeframe: canonical, period } : null;
}

/** cTrader timestamps are milliseconds; accept unix seconds too. */
function toTimestampMs(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function getCredentials() {
  return {
    clientId: (process.env.CTRADER_CLIENT_ID || '').trim(),
    clientSecret: (process.env.CTRADER_CLIENT_SECRET || '').trim(),
    supabaseUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''),
    serviceKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Access-Token');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { clientId, clientSecret, supabaseUrl, serviceKey } = getCredentials();
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'cTrader credentials not configured on server' });
    return;
  }

  const rawKey = extractRawKey(req.headers);
  let accessToken = '';
  let authenticatedUserId: string | null = null;
  let keyId: string | null = null;
  let defaultAccountId: number | null = null;
  let defaultIsDemo = true;

  const auditLog = (status: number) =>
    auditApiKeyCall({
      supabaseUrl,
      serviceKey,
      keyId,
      userId: authenticatedUserId,
      method: 'GET',
      path: '/api/ctrader/candles',
      status,
      durationMs: Date.now() - startTime,
      userAgent: String(req.headers['user-agent'] || 'AI Agent'),
    });

  try {
    const sessionAuth = JFX_PAT_PATTERN.test(rawKey) ? null : await requireUser(req.headers);
    if (sessionAuth?.ok && sessionAuth.userId) {
      if (!supabaseUrl || !serviceKey) {
        res.status(503).json({ error: 'Database service not configured' });
        return;
      }
      const connected = await loadUserCtraderAccessToken({
        supabaseUrl, serviceKey, clientId, clientSecret, userId: sessionAuth.userId,
      });
      if (!connected) {
        res.status(400).json({ error: 'ctrader_not_connected', message: 'Connect cTrader before requesting candles.' });
        return;
      }
      accessToken = connected.accessToken;
      defaultAccountId = connected.defaultAccountId;
      defaultIsDemo = connected.defaultIsDemo;
      authenticatedUserId = sessionAuth.userId;
    } else if (JFX_PAT_PATTERN.test(rawKey)) {
      const verified = await verifyApiKey({
        supabaseUrl, serviceKey, rawKey, requiredScope: 'trades:read',
      });
      if (!verified.ok) {
        const fail = verified as { status: number; error: string; need?: string; have?: string[]; hint?: string };
        if (fail.status === 429) res.setHeader('Retry-After', '60');
        const payload: Record<string, unknown> = { error: fail.error };
        if (fail.need) payload.need = fail.need;
        if (fail.have) payload.have = fail.have;
        if (fail.error === 'rate_limited') payload.retry_after = 60;
        res.status(fail.status).json(payload);
        return;
      }
      authenticatedUserId = verified.identity.userId;
      keyId = verified.identity.keyId;
      const connected = await loadUserCtraderAccessToken({
        supabaseUrl, serviceKey, clientId, clientSecret, userId: authenticatedUserId,
      });
      if (!connected) {
        res.status(400).json({
          error: 'ctrader_not_connected',
          message: 'Your JFX API key is valid, but your cTrader account has not been connected yet. Please connect cTrader once on the Connect & Import page in the web app.',
        });
        return;
      }
      accessToken = connected.accessToken;
      defaultAccountId = connected.defaultAccountId;
      defaultIsDemo = connected.defaultIsDemo;
    } else {
      res.status(401).json({ error: 'Missing X-API-Key or Authorization header' });
      return;
    }
  } catch (e: any) {
    console.error('[candles] auth error', e);
    if (!res.headersSent && e?.message === 'ctrader_refresh_in_progress') {
      res.setHeader('Retry-After', '1');
      res.status(503).json({ error: 'ctrader_refresh_in_progress', message: 'cTrader is refreshing this account. Retry in a moment.' });
      return;
    }
    if (!res.headersSent) res.status(500).json({ error: 'auth_failed', message: e?.message || String(e) });
    return;
  }

  const q = req.query;
  const rawSymbol = String(q.symbol || q.pair || q.instrument || q.ticker || '');
  const rawSymbolId = Number(q.symbolId || q.symbol_id) || 0;
  if (!rawSymbol && !rawSymbolId) {
    auditLog(400);
    res.status(400).json({
      error: "Query param 'symbol' (e.g. ?symbol=EURUSD) or 'symbolId' (e.g. ?symbolId=4) is required, plus ?timeframe=H1",
    });
    return;
  }
  const resolvedTimeframe = resolveTimeframe(String(q.timeframe || 'H1'));
  if (!resolvedTimeframe) {
    auditLog(400);
    res.status(400).json({
      error: 'invalid_timeframe',
      message: `Unknown timeframe '${String(q.timeframe)}'.`,
      allowed: ALLOWED_TIMEFRAMES,
    });
    return;
  }
  const { timeframe, period } = resolvedTimeframe;
  const count = Math.min(5000, Math.max(1, Number(q.count || q.limit || 500) || 500));
  const from = toTimestampMs(q.from);
  const to = toTimestampMs(q.to);
  let accountId = Number(q.ctidTraderAccountId || q.accountId || defaultAccountId) || null;
  const isDemo = parseIsDemo(q.isDemo, defaultIsDemo);
  const host = isDemo ? 'demo.ctraderapi.com' : 'live.ctraderapi.com';

  let session: WsSession | null = null;
  try {
    if (!accountId) {
      session = await openCtraderSession(host, clientId, clientSecret, 0, accessToken);
      const accListRes = await session.send(PT.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken });
      const accounts = accListRes.ctidTraderAccount || [];
      session.close();
      session = null;
      if (accounts.length === 0) {
        auditLog(400);
        res.status(400).json({ error: 'No cTrader accounts found for this user' });
        return;
      }
      accountId = Number(accounts[0].ctidTraderAccountId);
    }

    session = await openCtraderSession(host, clientId, clientSecret, accountId, accessToken);

    const symbolsRes = await session.send(PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId });
    // Positions/orders return raw symbolIds, so agents may only know the id.
    // Accept either param: a symbol name resolves via alias-aware
    // resolveSymbolId; a bare numeric symbolId is matched directly.
    let resolved: { symbolId: number; symbolName: string; digits: number } | null = null;
    if (rawSymbol) {
      resolved = resolveSymbolId(symbolsRes.symbol || [], rawSymbol);
      if (!resolved) {
        const suggestions = suggestSymbols(symbolsRes.symbol || [], rawSymbol);
        session.close();
        auditLog(400);
        res.status(400).json({
          error: `Symbol '${rawSymbol}' not found on account ${accountId}`,
          ...(suggestions.length > 0 ? { suggestions } : {}),
        });
        return;
      }
    } else {
      const byId = (symbolsRes.symbol || []).find((s: any) => Number((s as any).symbolId) === rawSymbolId);
      if (!byId) {
        session.close();
        auditLog(400);
        res.status(400).json({ error: `symbolId ${rawSymbolId} not found on account ${accountId}` });
        return;
      }
      const name = String((byId as any).symbolName || (byId as any).name || rawSymbolId);
      resolved = {
        symbolId: rawSymbolId,
        symbolName: name,
        digits: Number.isFinite(Number((byId as any).digits))
          ? Number((byId as any).digits)
          : /JPY/.test(name) ? 3 : 5,
      };
    }

    const payload: Record<string, any> = {
      ctidTraderAccountId: accountId,
      symbolId: resolved.symbolId,
      period,
      count,
    };
    if (from) payload.fromTimestamp = from;
    if (to) payload.toTimestamp = to;
    const barsRes = await session.send(PT.GET_TRENDBARS_REQ, payload);
    session.close();
    session = null;

    // cTrader trendbar prices are integers scaled by the symbol's digits —
    // use 10^digits (NOT a hardcoded 100000) so JPY pairs and synthetic
    // indices decode correctly. The response emits real price units.
    const digits = resolved.digits;
    const divisor = Math.pow(10, digits);
    const decodeBars = (barsRes: any) =>
      ((barsRes.trendbar || []) as any[]).map((bar: any) => {
        const low = Number(bar.low || 0) / divisor;
        let time = 0;
        if (bar.utcTimestampInMinutes) time = Number(bar.utcTimestampInMinutes) * 60;
        else if (bar.utcTimestamp) time = Math.floor(Number(bar.utcTimestamp) / 1000);
        else if (bar.timestamp) time = Math.floor(Number(bar.timestamp) / 1000);
        return {
          time,
          open: Number((low + Number(bar.deltaOpen || 0) / divisor).toFixed(digits)),
          high: Number((low + Number(bar.deltaHigh || 0) / divisor).toFixed(digits)),
          low: Number(low.toFixed(digits)),
          close: Number((low + Number(bar.deltaClose || 0) / divisor).toFixed(digits)),
        };
      }).sort((a: any, b: any) => a.time - b.time);

    let bars = decodeBars(barsRes);
    // The feed intermittently answers "ok but empty" right after a period
    // boundary or while its cache warms. One bounded retry has fixed real
    // user reports of consecutive empty payloads; surface it if it repeats.
    let retriedEmpty = false;
    if (bars.length === 0 && !from && !to) {
      await new Promise((r) => setTimeout(r, 400));
      const retryRes = await session.send(PT.GET_TRENDBARS_REQ, payload);
      bars = decodeBars(retryRes);
      retriedEmpty = true;
    }

    // Portfolio attribution so agents can tell which rule set (if any)
    // governs the account they just read candles from.
    const ctx = authenticatedUserId && supabaseUrl && serviceKey
      ? await resolvePortfolioContext({ supabaseUrl, serviceKey }, authenticatedUserId, accountId!)
      : null;
    const warnings: string[] = [];
    if (ctx && authenticatedUserId) {
      if (!ctx.portfolioId) warnings.push('account_not_linked_to_portfolio');
      if (ctx.locksUnchecked) warnings.push('locks_unchecked');
      if (ctx.portfolioIds.length > 1) warnings.push('multiple_portfolios_linked');
    }
    if (bars.length === 0) warnings.push('no_bars_for_window');
    else if (retriedEmpty) warnings.push('first_fetch_returned_no_bars_retried_ok');

    auditLog(200);
    res.status(200).json({
      ok: true,
      symbol: resolved.symbolName,
      symbolId: resolved.symbolId,
      timeframe,
      digits,
      // All bar values are real price units (e.g. USDJPY close 157.217),
      // NOT point-scaled integers. digits gives the display precision.
      unit: 'price',
      accountId,
      isDemo,
      ...(ctx
        ? {
            portfolioId: ctx.portfolioId,
            portfolioName: ctx.portfolioName,
            ...(ctx.portfolioIds.length > 1 ? { portfolioIds: ctx.portfolioIds } : {}),
          }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      count: bars.length,
      bars,
    });
  } catch (err: any) {
    if (session) { try { session.close(); } catch {} }
    auditLog(500);
    res.status(500).json({ error: err?.message || 'Candles request failed' });
  }
}
