import { Candle, EADeal, EAPosition } from '../types';
import { supabase } from '../lib/supabase';

const CTRADER_ID_BASE = 'https://id.ctrader.com';
const WS_DEMO = 'wss://demo.ctraderapi.com:5036';
const WS_LIVE = 'wss://live.ctraderapi.com:5036';

// OAuth client IDs are public identifiers. The cTrader client secret is kept
// exclusively in server environment variables; browser requests use the
// authenticated server proxy instead of direct protocol authentication.
const CLIENT_ID = import.meta.env.VITE_CTRADER_CLIENT_ID || '';
const CTRADER_VOLUME_CENTS_PER_UNIT = 100;
const CTRADER_UNITS_PER_LOT = 100000;
const CTRADER_VOLUME_CENTS_PER_LOT = CTRADER_VOLUME_CENTS_PER_UNIT * CTRADER_UNITS_PER_LOT;

export interface CtraderTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface CtraderAccount {
  ctidTraderAccountId: number;
  login: string;
  server: string;
  isDemo: boolean;
  currency: string;
  balance: number;
  equity: number;
  profit: number;
  margin: number;
  freeMargin: number;
  name: string;
  depositAssetId: number;
}

function dedupeAccountsByTraderId(accounts: CtraderAccount[]): CtraderAccount[] {
  const seen = new Map<number, CtraderAccount>();

  for (const account of accounts) {
    if (!seen.has(account.ctidTraderAccountId)) {
      seen.set(account.ctidTraderAccountId, account);
    }
  }

  return Array.from(seen.values());
}

function lotsToCtraderVolume(volumeLots: number): number {
  return Math.round(volumeLots * CTRADER_VOLUME_CENTS_PER_LOT);
}

function unitsToCtraderVolume(volumeUnits: number): number {
  return Math.round(volumeUnits * CTRADER_VOLUME_CENTS_PER_UNIT);
}

export interface CtraderDeal {
  dealId: number;
  orderId: number;
  symbol: string;
  symbolId?: number;
  tradeSide: 'buy' | 'sell';
  volume: number;
  price: number;
  profit: number;
  swap: number;
  commission: number;
  openTimestamp: string;
  closeTimestamp: string;
  stopLoss?: number;
  takeProfit?: number;
  entryPrice?: number;
}

export interface CtraderPosition {
  positionId: number;
  symbol: string;
  symbolId: number;
  volume: number;
  tradeSide: 'buy' | 'sell';
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap: number;
  commission: number;
  openTimestamp: string;
  stopLoss?: number;
  takeProfit?: number;
}

const SCOPE = 'trading'; // cTrader OAuth scope: trading includes accounts + trade execution (was 'accounts' → read-only, caused TRADE permission required)

// ------------------------------------------------------------------
// Token storage — memory only.
// The access token is held in a module variable (never persisted to
// localStorage/sessionStorage, so XSS cannot exfiltrate it). The long-lived
// refresh token is kept server-side in an httpOnly cookie set by
// /api/ctrader/exchange, and /api/ctrader/refresh uses that cookie to mint a
// fresh access token. After a page reload the access token is re-obtained via
// that silent refresh, so sessions survive reloads without storing secrets
// in the browser.
// ------------------------------------------------------------------
let memoryTokens: { accessToken: string; expiresAt: number } | null = null;
let refreshInFlight: Promise<boolean> | null = null;

/** Test helper only — seeds the in-memory token store. */
export function __setTokensForTesting(tokens: { accessToken: string; expiresAt: number } | null) {
  memoryTokens = tokens;
}

// ------------------------------------------------------------------
// Session persistence marker. The access token itself stays in memory,
// but this flag records that a cTrader OAuth session exists (the server
// holds the long-lived refresh credential), so the UI can restore the
// authenticated view immediately after a reload or view switch instead
// of flashing the "Connect" screen. Cleared only by an explicit logout.
// ------------------------------------------------------------------
const SESSION_FLAG_KEY = 'jfx_ctrader_session';
const OAUTH_STATE_KEY = 'jfx_ctrader_oauth_state';

function markSession() {
  try { localStorage.setItem(SESSION_FLAG_KEY, '1'); } catch { /* blocked */ }
}

/** True when a cTrader OAuth session exists for this browser. */
export function hasActiveSession(): boolean {
  try { return localStorage.getItem(SESSION_FLAG_KEY) === '1'; } catch { return false; }
}

function getStoredTokens(): { accessToken: string; expiresAt: number } | null {
  if (memoryTokens && Date.now() < memoryTokens.expiresAt) {
    return memoryTokens;
  }
  return null;
}

async function getOrWaitForSession(): Promise<{ jwt?: string; userId?: string } | null> {
  try {
    const sessionRes = await supabase.auth.getSession();
    let jwt = sessionRes?.data?.session?.access_token;
    let userId = sessionRes?.data?.session?.user?.id;
    if (jwt && userId) return { jwt, userId };

    // Fallback: check localStorage directly (Supabase persists session synchronously)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
        const item = localStorage.getItem(key);
        if (item) {
          try {
            const parsed = JSON.parse(item);
            jwt = parsed?.access_token || parsed?.token;
            userId = parsed?.user?.id || parsed?.user_id;
            if (jwt || userId) return { jwt, userId };
          } catch {}
        }
      }
    }
  } catch {}
  return null;
}

async function ctraderApiRequest(body: Record<string, unknown>): Promise<any> {
  const session = await getOrWaitForSession();
  if (!session?.jwt) throw new Error('Sign in again before using cTrader.');

  const res = await fetch('/api/ctrader/trade', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.jwt}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.message || data?.error || `cTrader request failed (HTTP ${res.status})`) as Error & {
      code?: string;
      status?: number;
      data?: unknown;
    };
    // Preserve structured server errors (e.g. `locked_by_rule`) so the UI can
    // render the correct message/notification instead of a generic failure.
    error.code = typeof data?.error === 'string' ? data.error : undefined;
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

/**
 * Restore a cTrader session without exposing or rotating a cookie-held token
 * in the browser. The authenticated server checks the user-scoped token store
 * and serializes any cTrader refresh internally.
 */
async function refreshTokensFromCookie(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      await ctraderApiRequest({ action: 'check_auth' });
      markSession();
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Return a valid token, silently refreshing from the httpOnly cookie when needed. */
export async function getTokens(): Promise<{ accessToken: string; expiresAt: number } | null> {
  // Kept for backward-compatible callers. Access tokens intentionally never
  // cross the browser boundary; only explicit test seeds can return one.
  return getStoredTokens();
}

/** Returns the active cTrader access token string for AI agent API use. */
export async function getActiveAccessToken(): Promise<string | null> {
  return null;
}

let wsDemo: WebSocket | null = null;
let wsLive: WebSocket | null = null;
let pendingReqs: Map<string, { resolve: (v: any) => void; reject: (e: any) => void; payloadType: number }> = new Map();
let msgCounter = 0;
let heartbeatIntervalDemo: ReturnType<typeof setInterval> | null = null;
let heartbeatIntervalLive: ReturnType<typeof setInterval> | null = null;
const appAuthDone = new Set<WebSocket>();
const appAuthPromises = new Map<WebSocket, Promise<void>>();
const accountAuthPromises = new Map<WebSocket, Map<number, Promise<void>>>();
let connectPromiseDemo: Promise<WebSocket> | null = null;
let connectPromiseLive: Promise<WebSocket> | null = null;

function nextMsgId(): string {
  msgCounter++;
  return `jfx_${msgCounter}_${Date.now()}`;
}

// Payload types from cTrader ProtoOAPayloadType — official proto values
// Source: https://github.com/spotware/openapi-proto-messages/blob/main/OpenApiModelMessages.proto
export const PT = {
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  VERSION_REQ: 2104,
  VERSION_RES: 2105,
  NEW_ORDER_REQ: 2106,
  TRAILING_SL_CHANGED_EVENT: 2107,
  CANCEL_ORDER_REQ: 2108,
  AMEND_ORDER_REQ: 2109,
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  ASSET_LIST_REQ: 2112,
  ASSET_LIST_RES: 2113,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  SYMBOLS_FOR_CONVERSION_REQ: 2118,
  SYMBOLS_FOR_CONVERSION_RES: 2119,
  SYMBOL_CHANGED_EVENT: 2120,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  TRADER_UPDATE_EVENT: 2123,
  RECONCILE_REQ: 2124,
  RECONCILE_RES: 2125,
  EXECUTION_EVENT: 2126,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  UNSUBSCRIBE_SPOTS_RES: 2130,
  SPOT_EVENT: 2131,
  ORDER_ERROR_EVENT: 2132,
  DEAL_LIST_REQ: 2133,
  DEAL_LIST_RES: 2134,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  EXPECTED_MARGIN_REQ: 2139,
  EXPECTED_MARGIN_RES: 2140,
  MARGIN_CHANGED_EVENT: 2141,
  ERROR_RES: 2142,
  CASH_FLOW_HISTORY_LIST_REQ: 2143,
  CASH_FLOW_HISTORY_LIST_RES: 2144,
  GET_TICKDATA_REQ: 2145,
  GET_TICKDATA_RES: 2146,
  ACCOUNTS_TOKEN_INVALIDATED_EVENT: 2147,
  CLIENT_DISCONNECT_EVENT: 2148,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
  GET_CTID_PROFILE_BY_TOKEN_REQ: 2151,
  GET_CTID_PROFILE_BY_TOKEN_RES: 2152,
  HEARTBEAT_EVENT: 51,
};

export type CtraderEventListener = (payloadType: number, payload: any, isDemo: boolean) => void;
const eventListeners = new Set<CtraderEventListener>();
const spotSubscriptions = new Map<string, { accountId: number; symbolIds: Set<number>; isDemo: boolean; version: number }>();
const spotStreamControllers = new Map<string, AbortController>();

const broadcastCtraderEvent = (payloadType: number, payload: any, isDemo: boolean) => {
  for (const listener of eventListeners) {
    try { listener(payloadType, payload, isDemo); } catch { /* listener isolation */ }
  }
};

export function addCtraderListener(listener: CtraderEventListener) {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

async function startSpotStream(accountId: number, isDemo: boolean): Promise<void> {
  const key = `${isDemo ? 'demo' : 'live'}:${accountId}`;
  const subscription = spotSubscriptions.get(key);
  if (!subscription || subscription.symbolIds.size === 0) return;
  const version = subscription.version;
  const symbolIds = [...subscription.symbolIds];

  spotStreamControllers.get(key)?.abort();
  const controller = new AbortController();
  spotStreamControllers.set(key, controller);

  const session = await getOrWaitForSession();
  if (!session?.jwt) throw new Error('Sign in again before using cTrader.');
  let response: Response;
  try {
    response = await fetch('/api/ctrader/trade', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.jwt}`,
      },
      body: JSON.stringify({
        action: 'stream_spots',
        ctidTraderAccountId: accountId,
        isDemo,
        payload: { symbolIds },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && subscription.version !== version) return;
    throw error;
  }
  if (subscription.version !== version) {
    controller.abort();
    return;
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || `Spot stream failed (HTTP ${response.status})`);
  }
  if (!response.body) throw new Error('Spot stream returned no response body.');

  void (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const event = /^event:\s*([^\n]+)/m.exec(frame)?.[1];
          const rawData = /^data:\s*(.+)$/m.exec(frame)?.[1];
          if (event !== 'spot' || !rawData) continue;
          try { broadcastCtraderEvent(PT.SPOT_EVENT, JSON.parse(rawData), isDemo); } catch { /* ignore malformed stream frame */ }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) console.warn('cTrader spot stream disconnected:', error);
    } finally {
      if (spotStreamControllers.get(key) === controller) spotStreamControllers.delete(key);
    }
  })();
}

async function ensureConnected(isDemo: boolean = true): Promise<WebSocket> {
  const existingWs = isDemo ? wsDemo : wsLive;
  if (existingWs && existingWs.readyState === WebSocket.OPEN) return existingWs;

  // If a connection is already being established, piggyback on that promise
  // This prevents concurrent callers from each opening (and closing) their own socket
  const activePromise = isDemo ? connectPromiseDemo : connectPromiseLive;
  if (activePromise) return activePromise;

  const newPromise: Promise<WebSocket> = (async () => {
    const tokens = await getTokens();
    if (!tokens) throw new Error('Not authenticated with cTrader');

    // Close any stale socket before creating a new one
    if (existingWs) {
      try { existingWs.close(); } catch { /* ignore */ }
      appAuthDone.delete(existingWs);
      appAuthPromises.delete(existingWs);
      accountAuthPromises.delete(existingWs);
      if (isDemo) wsDemo = null;
      else wsLive = null;
    }

    const url = isDemo ? WS_DEMO : WS_LIVE;
    const socket = new WebSocket(url);
    socket.binaryType = 'blob';
    if (isDemo) wsDemo = socket;
    else wsLive = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (isDemo) connectPromiseDemo = null;
        else connectPromiseLive = null;
        reject(new Error(`WebSocket connection timeout (30s) - ${isDemo ? 'Demo' : 'Live'}`));
      }, 30000);

      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        if (isDemo) connectPromiseDemo = null;
        else connectPromiseLive = null;
        reject(new Error(`WebSocket connection failed - ${isDemo ? 'Demo' : 'Live'}`));
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        stopHeartbeat(isDemo);
        appAuthDone.delete(socket);
        appAuthPromises.delete(socket);
        accountAuthPromises.delete(socket);
        if (isDemo) connectPromiseDemo = null;
        else connectPromiseLive = null;
        if (isDemo && wsDemo === socket) wsDemo = null;
        if (!isDemo && wsLive === socket) wsLive = null;
        reject(new Error(`WebSocket closed before open - ${isDemo ? 'Demo' : 'Live'}`));
      };
    });

    // Connection succeeded — clear the cached promise so future reconnects work
    if (isDemo) connectPromiseDemo = null;
    else connectPromiseLive = null;

    // Keep the connection alive. cTrader drops sockets that stop exchanging
    // heartbeats, which used to leave a dead cached socket behind by the time
    // the user returned to the terminal (surfacing as CANT_ROUTE_REQUEST).
    startHeartbeat(socket, isDemo);

    socket.onmessage = async (event) => {
      try {
        let dataStr: string;
        if (typeof event.data === 'string') {
          dataStr = event.data;
        } else if (event.data instanceof Blob) {
          if (typeof event.data.text === 'function') {
            dataStr = await event.data.text();
          } else {
            dataStr = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error || new Error('Blob read error'));
              reader.readAsText(event.data);
            });
          }
        } else if (event.data instanceof ArrayBuffer) {
          dataStr = new TextDecoder().decode(event.data);
        } else {
          dataStr = String(event.data);
        }

        const msg = JSON.parse(dataStr);
        const clientId = msg.clientMsgId;
        if (clientId && pendingReqs.has(clientId)) {
          const pending = pendingReqs.get(clientId)!;
          pendingReqs.delete(clientId);
          if (msg.payloadType === PT.ERROR_RES) {
            const errorCode = msg.payload?.errorCode || 'cTrader error';
            // ProtoOAErrorRes carries a human-readable description alongside
            // the machine code — surface both for diagnosability.
            const description = msg.payload?.description;
            pending.reject(new Error(description ? `${errorCode}: ${description}` : String(errorCode)));
          } else {
            pending.resolve(msg.payload);
          }
        }

        broadcastCtraderEvent(msg.payloadType, msg.payload, isDemo);
      } catch { /* ignore parse errors */ }
    };

    return socket;
  })();

  if (isDemo) connectPromiseDemo = newPromise;
  else connectPromiseLive = newPromise;

  return newPromise;
}


function sendWsMessage(socket: WebSocket, payloadType: number, payload: Record<string, any>, timeoutMs: number = 20000): Promise<any> {
  return new Promise((resolve, reject) => {
    const clientMsgId = nextMsgId();
    // Without a timeout a request sent into a dead/zombie socket would hang
    // forever (the server is gone, so no response ever arrives).
    const timer = setTimeout(() => {
      pendingReqs.delete(clientMsgId);
      reject(new Error(`Request timed out (payloadType ${payloadType})`));
    }, timeoutMs);
    pendingReqs.set(clientMsgId, {
      resolve: (value: any) => { clearTimeout(timer); resolve(value); },
      reject: (reason: any) => { clearTimeout(timer); reject(reason); },
      payloadType,
    });
    try {
      socket.send(JSON.stringify({
        clientMsgId,
        payloadType,
        payload,
      }));
    } catch (e) {
      clearTimeout(timer);
      pendingReqs.delete(clientMsgId);
      reject(new Error(`WebSocket send failed: ${String((e as any)?.message || e)}`));
    }
  });
}

function startHeartbeat(socket: WebSocket, isDemo: boolean) {
  stopHeartbeat(isDemo);
  const interval = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        clientMsgId: nextMsgId(),
        payloadType: PT.HEARTBEAT_EVENT,
        payload: {},
      }));
    }
  }, 10000);

  if (isDemo) heartbeatIntervalDemo = interval;
  else heartbeatIntervalLive = interval;
}

function stopHeartbeat(isDemo?: boolean) {
  if (isDemo === undefined || isDemo === true) {
    if (heartbeatIntervalDemo) {
      clearInterval(heartbeatIntervalDemo);
      heartbeatIntervalDemo = null;
    }
  }
  if (isDemo === undefined || isDemo === false) {
    if (heartbeatIntervalLive) {
      clearInterval(heartbeatIntervalLive);
      heartbeatIntervalLive = null;
    }
  }
}

export function getAuthorizeUrl(): string {
  if (!CLIENT_ID) throw new Error('cTrader client ID is not configured (VITE_CTRADER_CLIENT_ID).');
  const redirectUri = `${window.location.origin}/api/ctrader/callback`;
  const url = new URL(`${CTRADER_ID_BASE}/my/settings/openapi/grantingaccess/`);
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  } catch {
    throw new Error('Browser storage is required to start cTrader authorization.');
  }
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('product', 'web');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCode(code: string, state: string | null): Promise<{ ok: boolean; error?: string }> {
  const redirectUri = `${window.location.origin}/api/ctrader/callback`;
  try {
    const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    // The installed native app uses its registered deep-link state. Browser
    // authorizations must always match the one-time state generated above.
    const isNativeCallback = state === 'jfx-native';
    if (!isNativeCallback && (!state || !expectedState || state !== expectedState)) {
      return { ok: false, error: 'Invalid or expired cTrader authorization state. Please try connecting again.' };
    }
    if (expectedState) sessionStorage.removeItem(OAUTH_STATE_KEY);
    const session = await getOrWaitForSession();
    const jwt = session?.jwt;
    if (!jwt) return { ok: false, error: 'Sign in again before connecting cTrader.' };
    const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };

    const queryParams = new URLSearchParams({
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetch(`/api/ctrader/exchange?${queryParams.toString()}`, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || data?.errorCode || `HTTP ${res.status}`;
      console.warn('[cTrader] exchange failed:', msg, data);
      return { ok: false, error: String(msg) };
    }
    if (data.ok) {
      markSession();
      return { ok: true };
    }
    return { ok: false, error: data?.error || 'No tokens in response' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}


export function isAuthenticated(): boolean {
  return hasActiveSession();
}

export async function refreshToken(): Promise<boolean> {
  return refreshTokensFromCookie();
}

const SELECTED_ACCOUNT_KEY = 'jfx_ctrader_selected_account';

/** Persist the user's preferred cTrader account so it survives redirects. */
export function setSelectedAccountId(id: number) {
  try { localStorage.setItem(SELECTED_ACCOUNT_KEY, String(id)); } catch { /* blocked */ }
}

/** Read the previously selected cTrader account id, or null. */
export function getSelectedAccountId(): number | null {
  try {
    const raw = localStorage.getItem(SELECTED_ACCOUNT_KEY);
    return raw ? Number(raw) : null;
  } catch { return null; }
}

/** Clear the persisted cTrader account id. */
export function clearSelectedAccountId() {
  try { localStorage.removeItem(SELECTED_ACCOUNT_KEY); } catch { /* blocked */ }
}

/**
 * Clear only the persisted "was connected" markers (local flag + dev token)
 * without touching sockets. Used when a session is proven dead server-side
 * so the UI stops showing a stale "connected" state.
 */
export function clearStaleCtraderFlags() {
  try { localStorage.removeItem(SESSION_FLAG_KEY); } catch { /* blocked */ }
}

export function logout() {
  memoryTokens = null;
  clearSelectedAccountId();
  try { localStorage.removeItem(SESSION_FLAG_KEY); } catch { /* blocked */ }
  // Clear the server-side refresh cookie (best-effort).
  // Shares the trade route with an `action=logout` flag: Vercel Hobby caps a
  // deployment at 12 Serverless Functions, so a standalone
  // api/ctrader/logout.ts pushed the build over that limit.
  try { void fetch('/api/ctrader/trade?action=logout', { method: 'POST' }); } catch { /* ignore */ }
  appAuthDone.clear();
  appAuthPromises.clear();
  accountAuthPromises.clear();
  connectPromiseDemo = null;
  connectPromiseLive = null;
  for (const controller of spotStreamControllers.values()) controller.abort();
  spotStreamControllers.clear();
  spotSubscriptions.clear();
  if (wsDemo) {
    wsDemo.close();
    wsDemo = null;
  }
  if (wsLive) {
    wsLive.close();
    wsLive = null;
  }
  stopHeartbeat();
}

export async function getAccounts(): Promise<CtraderAccount[]> {
  const data = await ctraderApiRequest({ action: 'get_accounts' });
  const accounts = (data.accounts || []).map((account: any) => ({
    ctidTraderAccountId: Number(account.accountId),
    login: String(account.traderLogin || account.accountId),
    server: String(account.broker || ''),
    isDemo: account.isDemo !== undefined ? Boolean(account.isDemo) : !account.isLive,
    currency: String(account.currency || 'USD'),
    balance: Number(account.balance || 0),
    equity: Number(account.equity || 0),
    profit: Number(account.profit || 0),
    margin: Number(account.margin || 0),
    freeMargin: Number(account.freeMargin || 0),
    name: String(account.name || `Account #${account.traderLogin || account.accountId}`),
    depositAssetId: Number(account.depositAssetId || 0),
  }));
  return dedupeAccountsByTraderId(accounts as CtraderAccount[]);
}
export async function authAccount(ctidTraderAccountId: number, isDemo: boolean = true): Promise<void> {
  void ctidTraderAccountId;
  void isDemo;
  const session = await getOrWaitForSession();
  if (!session?.jwt) throw new Error('Sign in again before using cTrader.');
}

const isCantRouteError = (e: any) => String(e?.message || e).includes('CANT_ROUTE_REQUEST');
const isRefreshInProgressError = (e: any) => String(e?.message || e).includes('ctrader_refresh_in_progress');

const isRecoverableConnectionError = (e: any) => {
  const msg = String(e?.message || e);
  return msg.includes('timed out')
    || msg.includes('WebSocket closed')
    || msg.includes('WebSocket send failed')
    || msg.includes('WebSocket connection');
};

// Tears down a cached socket and its auth state so the next request
// reconnects from scratch (used to self-heal stale/zombie connections).
function forceReconnect(isDemo: boolean) {
  const socket = isDemo ? wsDemo : wsLive;
  if (socket) {
    appAuthDone.delete(socket);
    appAuthPromises.delete(socket);
    accountAuthPromises.delete(socket);
    try { socket.close(); } catch { /* ignore */ }
  }
  if (isDemo) { wsDemo = null; connectPromiseDemo = null; }
  else { wsLive = null; connectPromiseLive = null; }
  stopHeartbeat(isDemo);
}

// ensureConnected → authAccount → send, with self-healing: a stale socket
// (connection died while the user was away — the usual cause of
// CANT_ROUTE_REQUEST when returning to the terminal) triggers one clean
// reconnect + retry. Read-only callers may also allow a final retry on the
// opposite environment, since CANT_ROUTE almost always means the account
// lives on the other cTrader host (demo vs live). Trading mutations never
// fall back — silently switching environments there would be dangerous.
async function authenticatedRequest(
  ctidTraderAccountId: number,
  payloadType: number,
  payload: Record<string, any>,
  isDemo: boolean,
  options: { allowEnvironmentFallback?: boolean } = {}
): Promise<any> {
  const send = async (envIsDemo: boolean) => {
    const response = await ctraderApiRequest({
      action: 'proxy',
      ctidTraderAccountId,
      isDemo: envIsDemo,
      payloadType,
      payload,
    });
    return response.result;
  };

  try {
    return await send(isDemo);
  } catch (error) {
    if (isRefreshInProgressError(error)) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return send(isDemo);
    }
    if (!options.allowEnvironmentFallback || !isCantRouteError(error)) throw error;
    return send(!isDemo);
  }
}
export async function getPositions(ctidTraderAccountId: number, isDemo: boolean = true): Promise<CtraderPosition[]> {
  const data = await authenticatedRequest(ctidTraderAccountId, PT.RECONCILE_REQ, {
    ctidTraderAccountId,
  }, isDemo, { allowEnvironmentFallback: true });

  return (data.position || []).map((pos: any) => {
    // cTrader positions have nested tradeData for symbol/volume/side
    const tradeData = pos.tradeData || pos;
    return {
      positionId: Number(pos.positionId),
      symbol: tradeData.symbolName || tradeData.symbol || String(tradeData.symbolId || ''),
      symbolId: Number(tradeData.symbolId),
      volume: Number(tradeData.volume ?? 0) / 10000000,
      tradeSide: tradeData.tradeSide === 1 ? 'buy' : 'sell',
      openPrice: Number(pos.price ?? tradeData.openPrice ?? 0),
      currentPrice: Number(pos.currentPrice ?? 0),
      profit: Number(pos.profit ?? 0) / 100,
      swap: Number(pos.swap ?? 0) / 100,
      commission: Number(pos.commission ?? 0) / 100,
      openTimestamp: new Date(Number(tradeData.openTimestamp ?? Date.now())).toISOString(),
      stopLoss: pos.stopLoss ? Number(pos.stopLoss) : undefined,
      takeProfit: pos.takeProfit ? Number(pos.takeProfit) : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// cTrader ProtoOA absolute prices are integers scaled by the symbol's "digits"
// (e.g. EURUSD 5 digits → 108245 means 1.08245; JPY pairs 3 digits).
// Monetary fields (profit/swap/commission/balance/equity) arrive in cents and
// are divided by 100 at their respective map sites.
// ---------------------------------------------------------------------------
export type SymbolDigitsMap = Map<number, number>;

export const buildDigitsMap = (symbols: any[]): SymbolDigitsMap => {
  const map: SymbolDigitsMap = new Map();
  (symbols || []).forEach((s: any) => {
    if (s && s.symbolId !== undefined) {
      const digits = Number(s.digits);
      if (Number.isFinite(digits)) map.set(Number(s.symbolId), digits);
    }
  });
  return map;
};

export const scalePrice = (
  raw: unknown,
  symbolId: unknown,
  digitsById: SymbolDigitsMap | undefined,
  symbolName?: string
): number => {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  let digits = symbolId !== undefined && symbolId !== null && digitsById
    ? digitsById.get(Number(symbolId))
    : undefined;
  if (digits === undefined) {
    // Fallback heuristic matching the chart helper: JPY quote → 3, else 5.
    const clean = (symbolName || '').toUpperCase().replace('/', '');
    digits = clean.endsWith('JPY') ? 3 : 5;
  }
  return n / Math.pow(10, digits);
};

export async function getClosedDeals(ctidTraderAccountId: number, fromTimestamp?: number, toTimestamp?: number, isDemo: boolean = true, digitsById?: SymbolDigitsMap): Promise<CtraderDeal[]> {
  const payload: Record<string, any> = {
    ctidTraderAccountId,
  };
  // cTrader expects timestamps in MILLISECONDS
  if (fromTimestamp) payload.fromTimestamp = fromTimestamp;
  if (toTimestamp) payload.toTimestamp = toTimestamp;

  const data = await authenticatedRequest(ctidTraderAccountId, PT.DEAL_LIST_REQ, payload, isDemo, { allowEnvironmentFallback: true });

  const rawDeals = data.deal || [];
  const parseTimestamp = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const numericValue = Number(value);
    const timestamp = Number.isFinite(numericValue) ? numericValue : new Date(String(value)).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
  };
  const getPositionId = (deal: any): string | undefined => {
    const positionId = deal.positionId ?? deal.tradeData?.positionId ?? deal.closePositionDetail?.positionId;
    return positionId === undefined || positionId === null ? undefined : String(positionId);
  };

  // A close deal's createTimestamp is often the same as its execution time.
  // Build an index from all returned position deals so a close can use the
  // position's first execution as its opening time instead.
  const earliestPositionExecution = new Map<string, number>();
  rawDeals.forEach((deal: any) => {
    const positionId = getPositionId(deal);
    const executionTime = parseTimestamp(deal.executionTimestamp ?? deal.createTimestamp);
    if (!positionId || !executionTime) return;
    const currentEarliest = earliestPositionExecution.get(positionId);
    if (!currentEarliest || executionTime < currentEarliest) {
      earliestPositionExecution.set(positionId, executionTime);
    }
  });

  // cTrader returns every execution deal, including position-opening deals.
  // Opening deals carry no closePositionDetail (no grossProfit/swap), so they
  // would surface as commission-only rows in the history. Keep them for the
  // earliest-execution index above, but exclude them from the results.
  const closingDeals = rawDeals.filter((deal: any) => {
    const detail = deal.closePositionDetail;
    return !!detail && typeof detail === 'object' && Object.keys(detail).length > 0;
  });

  return closingDeals.map((deal: any) => {
    const tradeData = deal.tradeData || {};
    const closePositionDetail = deal.closePositionDetail || {};
    const rawSymbolId = deal.symbolId ?? tradeData.symbolId ?? deal.closePositionDetail?.symbolId;
    const symbolId = rawSymbolId !== undefined && rawSymbolId !== null ? Number(rawSymbolId) : undefined;
    const positionOpenTime = earliestPositionExecution.get(getPositionId(deal) || '');
    const openTime = parseTimestamp(
      closePositionDetail.entryTimestamp ??
      closePositionDetail.openTimestamp ??
      tradeData.openTimestamp ??
      deal.openTimestamp
    ) ?? positionOpenTime ?? parseTimestamp(deal.createTimestamp);
    const closeTime = parseTimestamp(deal.executionTimestamp) ?? parseTimestamp(deal.createTimestamp);

    return {
      dealId: Number(deal.dealId),
      orderId: Number(deal.orderId ?? 0),
      symbol: deal.symbolName || deal.symbol || tradeData.symbolName || tradeData.symbol || '',
      symbolId: typeof symbolId === 'number' && Number.isFinite(symbolId) ? symbolId : undefined,
      tradeSide: deal.tradeSide === 1 ? 'buy' : 'sell',
      volume: Number(deal.filledVolume ?? deal.volume ?? 0) / 10000000,
      price: scalePrice(deal.executionPrice ?? deal.price ?? 0, symbolId, digitsById, deal.symbolName || tradeData.symbolName),
      profit: Number(deal.closePositionDetail?.grossProfit ?? deal.profit ?? 0) / 100,
      swap: Number(deal.closePositionDetail?.swap ?? deal.swap ?? 0) / 100,
      commission: Number(deal.commission ?? 0) / 100,
      openTimestamp: openTime ? new Date(openTime).toISOString() : '',
      closeTimestamp: closeTime ? new Date(closeTime).toISOString() : '',
      stopLoss: deal.closePositionDetail?.stopLoss
        ? scalePrice(deal.closePositionDetail.stopLoss, symbolId, digitsById, deal.symbolName || tradeData.symbolName)
        : undefined,
      takeProfit: deal.closePositionDetail?.takeProfit
        ? scalePrice(deal.closePositionDetail.takeProfit, symbolId, digitsById, deal.symbolName || tradeData.symbolName)
        : undefined,
      entryPrice: deal.closePositionDetail?.entryPrice
        ? scalePrice(deal.closePositionDetail.entryPrice, symbolId, digitsById, deal.symbolName || tradeData.symbolName)
        : undefined,
    };
  });
}

export interface CtraderCashFlow {
  depositId: number;
  transactionId: string;
  operationType: 'deposit' | 'withdrawal';
  amount: number;
  timestamp: string;
  creditFacility: boolean;
}

/**
 * Fetches the deposit/withdrawal history (ProtoOACashFlowHistoryListReq/Res,
 * payload types 2143/2144) for an account.
 *
 * Protocol constraints (per help.ctrader.com/open-api/messages):
 *  - fromTimestamp AND toTimestamp are REQUIRED
 *  - each window may span at most 604800000 ms (7 days)
 *  - response repeated field is `depositWithdraw`
 *
 * We therefore walk backwards in 7-day windows (batched), dedupe by depositId,
 * and — because CANT_ROUTE_REQUEST almost always means the account lives on the
 * OTHER environment (demo vs live host) — automatically retry once on the
 * opposite host before giving up.
 */
export async function getCashFlowHistory(
  ctidTraderAccountId: number,
  fromTimestamp?: number,
  toTimestamp?: number,
  isDemo: boolean = true
): Promise<CtraderCashFlow[]> {
  const MAX_WINDOW_MS = 604800000; // 7 days — server-enforced maximum
  const MAX_TO_TIMESTAMP = 2147483646000; // 19 Jan 2038 — server-enforced ceiling
  const BATCH_SIZE = 10;

  const end = Math.min(toTimestamp ?? Date.now(), MAX_TO_TIMESTAMP);
  const start = Math.max(fromTimestamp ?? end - 3 * 365 * 24 * 60 * 60 * 1000, 0);

  const merged = new Map<number, CtraderCashFlow>();

  const collectEntries = (data: any) => {
    ((data?.depositWithdraw || data?.depositWithdrawal || data?.depositWithdrawals) || []).forEach((entry: any) => {
      const depositId = Number(entry.depositId);
      if (!Number.isFinite(depositId)) return;
      if (merged.has(depositId)) return;

      // Amount arrives in cents — convert to major units and sign by type
      // (deposits positive, withdrawals negative) to match CashTransaction norms.
      const rawAmount = Number(entry.amount ?? 0) / 100;
      const isWithdrawal = Number(entry.operationType) === 1;
      const ts = Number(entry.timestamp ?? entry.createTimestamp ?? 0);

      merged.set(depositId, {
        depositId,
        transactionId: String(entry.transactionId || ''),
        operationType: isWithdrawal ? 'withdrawal' : 'deposit',
        amount: isWithdrawal ? -Math.abs(rawAmount) : Math.abs(rawAmount),
        timestamp: ts > 0 ? new Date(ts).toISOString() : new Date(end).toISOString(),
        creditFacility: Boolean(entry.creditFacility),
      });
    });
  };

  // Individual window requests have no built-in timeout; cap them so one hung
  // response can't stall the entire history walk.
  const withTimeout = <T,>(p: Promise<T>, ms: number = 20000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cash flow window request timed out')), ms);
      p.then(
        value => { clearTimeout(timer); resolve(value); },
        err => { clearTimeout(timer); reject(err); }
      );
    });

  const buildWindowPayload = (windowStart: number, windowEnd: number) => ({
    ctidTraderAccountId,
    fromTimestamp: Math.max(windowStart, 0),
    toTimestamp: Math.min(windowEnd, MAX_TO_TIMESTAMP),
  });

  const isRoutingError = (e: any) => String(e?.message || e).includes('CANT_ROUTE_REQUEST');

  // Probes the newest window first so a misrouted/unsupported account fails
  // fast instead of after hundreds of requests.
  const runOnEnvironment = async (envIsDemo: boolean): Promise<void> => {
    const windows: Array<{ s: number; e: number }> = [];
    for (let windowEnd = end; windowEnd > start; windowEnd -= MAX_WINDOW_MS) {
      windows.push({ s: Math.max(start, windowEnd - MAX_WINDOW_MS + 1), e: windowEnd });
    }

    const [first, ...rest] = windows;
    await withTimeout(authenticatedRequest(ctidTraderAccountId, PT.CASH_FLOW_HISTORY_LIST_REQ, buildWindowPayload(first.s, first.e), envIsDemo))
      .then(collectEntries);

    for (let i = 0; i < rest.length; i += BATCH_SIZE) {
      const batch = rest.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(w => withTimeout(authenticatedRequest(ctidTraderAccountId, PT.CASH_FLOW_HISTORY_LIST_REQ, buildWindowPayload(w.s, w.e), envIsDemo)))
      );
      results.forEach(res => {
        if (res.status === 'fulfilled') collectEntries(res.value);
        else console.warn(`[cTrader] cash flow window failed (${envIsDemo ? 'demo' : 'live'}):`, (res.reason as any)?.message || res.reason);
      });
    }
  };

  try {
    await runOnEnvironment(isDemo);
  } catch (error) {
    if (!isRoutingError(error)) {
      // Transient/window errors were logged above; only surface a total failure.
      if (merged.size === 0) {
        throw new Error(`${String((error as any)?.message || error)} (while fetching cash-flow history for account ${ctidTraderAccountId})`);
      }
    } else {
      // CANT_ROUTE_REQUEST ⇒ almost always a demo/live host mismatch.
      // Retry the opposite environment once before giving up.
      try {
        await runOnEnvironment(!isDemo);
      } catch (altError) {
        if (merged.size === 0) {
          throw new Error(
            `CANT_ROUTE_REQUEST: could not reach the deposit/withdrawal history endpoint for account ${ctidTraderAccountId} on either cTrader environment. ${(altError as any)?.message || altError}`
          );
        }
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function disconnect() {
  appAuthDone.clear();
  appAuthPromises.clear();
  accountAuthPromises.clear();
  connectPromiseDemo = null;
  connectPromiseLive = null;
  if (wsDemo) {
    wsDemo.close();
    wsDemo = null;
  }
  if (wsLive) {
    wsLive.close();
    wsLive = null;
  }
  stopHeartbeat();
}

// Maps a cTrader position to the app's EAPosition shape.
// Note: volume/profit/swap/commission arrive already converted from cents
// by getPositions() above, so no further division is needed here.
export function mapCtraderPositionToEAPosition(pos: CtraderPosition): EAPosition {
  return {
    ticket: pos.positionId,
    symbol: pos.symbol,
    volume: pos.volume,
    type: pos.tradeSide === 'buy' ? 'BUY' : 'SELL',
    open_price: pos.openPrice,
    current_price: pos.currentPrice,
    profit: pos.profit,
    comment: undefined,
    magic: undefined,
    time: new Date(pos.openTimestamp).getTime(),
  };
}

// Maps a cTrader deal to the app's EADeal shape.
// Note: volume/profit/swap/commission arrive already converted from cents
// by getClosedDeals() above, so no further division is needed here.
export function mapCtraderDealToEADeal(deal: CtraderDeal): EADeal {
  return {
    ticket: deal.dealId,
    order: deal.orderId,
    time: new Date(deal.closeTimestamp).getTime() / 1000,
    symbol: deal.symbol,
    type: deal.tradeSide === 'buy' ? 'BUY' : 'SELL',
    entry: 0,
    price: deal.price,
    volume: deal.volume,
    profit: deal.profit,
    swap: deal.swap,
    commission: deal.commission,
    entry_time: deal.openTimestamp ? new Date(deal.openTimestamp).getTime() / 1000 : undefined,
    entry_price: deal.entryPrice,
    sl: deal.stopLoss,
    tp: deal.takeProfit,
  };
}

export interface CtraderOrder {
  orderId: number;
  symbol: string;
  volume: number;
  tradeSide: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export async function getCtidProfile(): Promise<any> {
  const accounts = await getAccounts();
  const account = accounts[0];
  if (!account) throw new Error('No cTrader accounts are available.');
  const data = await authenticatedRequest(account.ctidTraderAccountId, PT.GET_CTID_PROFILE_BY_TOKEN_REQ, {}, account.isDemo);
  return data.profile;
}

export async function getTrader(ctidTraderAccountId: number, isDemo: boolean = true): Promise<any> {
  const data = await authenticatedRequest(ctidTraderAccountId, PT.TRADER_REQ, {
    ctidTraderAccountId,
  }, isDemo, { allowEnvironmentFallback: true });
  // ProtoOA monetary fields arrive in cents — normalize once at the boundary
  // so every consumer (UI display, balance resolution) sees account currency.
  const trader = data.trader || {};
  return {
    ...trader,
    balance: trader.balance !== undefined ? Number(trader.balance) / 100 : undefined,
    equity: trader.equity !== undefined ? Number(trader.equity) / 100 : undefined,
    margin: trader.margin !== undefined ? Number(trader.margin) / 100 : undefined,
  };
}

export async function getPendingOrders(ctidTraderAccountId: number, isDemo: boolean = true): Promise<CtraderOrder[]> {
  const data = await authenticatedRequest(ctidTraderAccountId, PT.RECONCILE_REQ, {
    ctidTraderAccountId,
  }, isDemo, { allowEnvironmentFallback: true });
  return (data.order || []).map((ord: any) => {
    return {
      orderId: Number(ord.orderId),
      symbol: ord.symbolName || ord.symbol || '',
      volume: Number(ord.volume ?? 0) / 10000000,
      tradeSide: ord.tradeSide === 1 ? 'buy' : 'sell',
      orderType: ord.orderType === 1 ? 'market' : ord.orderType === 2 ? 'limit' : ord.orderType === 3 ? 'stop' : 'stop_limit',
      limitPrice: ord.limitPrice ? Number(ord.limitPrice) : undefined,
      stopPrice: ord.stopPrice ? Number(ord.stopPrice) : undefined,
      stopLoss: ord.stopLoss ? Number(ord.stopLoss) : undefined,
      takeProfit: ord.takeProfit ? Number(ord.takeProfit) : undefined,
    };
  });
}

/**
 * Opens a new order on a cTrader account.
 *
 * Supports market (orderType 1), limit (2), stop (3), and stop-limit (4) orders.
 * Volume is in lots (1 lot = 100,000 units). Optional stopLoss / takeProfit are
 * absolute prices (e.g. 1.08000 for EURUSD).
 *
 * ProtoOA: ProtoOANewOrderReq (payloadType 2106)
 */
export async function createNewOrder(
  ctidTraderAccountId: number,
  symbolId: number,
  tradeSide: 'buy' | 'sell',
  volume: number,
  optionsOrLimitPrice?: {
    limitPrice?: number;
    stopPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    isDemo?: boolean;
    comment?: string;
  } | number,
  legacyStopPrice?: number,
  legacyIsDemo?: boolean
): Promise<any> {
  const isOptionsObj = typeof optionsOrLimitPrice === 'object' && optionsOrLimitPrice !== null;
  const limitPrice = isOptionsObj ? optionsOrLimitPrice.limitPrice : optionsOrLimitPrice;
  const stopPrice = isOptionsObj ? optionsOrLimitPrice.stopPrice : legacyStopPrice;
  const stopLoss = isOptionsObj ? optionsOrLimitPrice.stopLoss : undefined;
  const takeProfit = isOptionsObj ? optionsOrLimitPrice.takeProfit : undefined;
  const isDemo = isOptionsObj ? (optionsOrLimitPrice.isDemo ?? true) : (legacyIsDemo ?? true);
  const comment = isOptionsObj ? optionsOrLimitPrice.comment : undefined;

  let orderType = 1; // 1=MARKET, 2=LIMIT, 3=STOP, 4=STOP_LIMIT
  if (limitPrice && stopPrice) orderType = 4;
  else if (limitPrice) orderType = 2;
  else if (stopPrice) orderType = 3;

  // Auto-detect lots vs units: volumes >= 500 are units; < 500 are lots.
  const volumeCents = volume >= 500 ? unitsToCtraderVolume(volume) : lotsToCtraderVolume(volume);

  const payload: Record<string, any> = {
    ctidTraderAccountId,
    symbolId,
    orderType,
    tradeSide: tradeSide === 'buy' ? 1 : 2,
    volume: volumeCents,
  };

  if (limitPrice) payload.limitPrice = limitPrice;
  if (stopPrice) payload.stopPrice = stopPrice;
  if (stopLoss) payload.stopLoss = stopLoss;
  if (takeProfit) payload.takeProfit = takeProfit;
  if (comment) payload.comment = comment;

  return authenticatedRequest(ctidTraderAccountId, PT.NEW_ORDER_REQ, payload, isDemo);
}

/**
 * Closes an open position, fully or partially.
 *
 * volume: how many lots (e.g. 0.01) or units (e.g. 1000) to close.
 *
 * ProtoOA: ProtoOAClosePositionReq (payloadType 2111)
 */
export async function closePosition(
  ctidTraderAccountId: number,
  positionId: number,
  volume: number,
  isDemo: boolean = true
): Promise<any> {
  const volumeCents = volume >= 500 ? unitsToCtraderVolume(volume) : lotsToCtraderVolume(volume);
  return authenticatedRequest(ctidTraderAccountId, PT.CLOSE_POSITION_REQ, {
    ctidTraderAccountId,
    positionId,
    volume: volumeCents,
  }, isDemo);
}

/**
 * Cancels a pending (limit/stop) order.
 *
 * ProtoOA: ProtoOACancelOrderReq (payloadType 2108)
 */
export async function cancelOrder(
  ctidTraderAccountId: number,
  orderId: number,
  isDemo: boolean = true
): Promise<any> {
  return authenticatedRequest(ctidTraderAccountId, PT.CANCEL_ORDER_REQ, {
    ctidTraderAccountId,
    orderId,
  }, isDemo);
}

/**
 * Modifies the Stop Loss and/or Take Profit on an open position.
 *
 * Prices must be absolute (e.g. 1.08000 for EURUSD), not relative pips.
 * Pass undefined to leave an existing SL or TP unchanged, or 0 to remove it.
 *
 * ProtoOA: ProtoOAAmendPositionSLTPReq (payloadType 2110)
 */
export async function amendPositionSltp(
  ctidTraderAccountId: number,
  positionId: number,
  options: {
    stopLoss?: number;
    takeProfit?: number;
    guaranteedStopLoss?: boolean;
    isDemo?: boolean;
  } = {}
): Promise<any> {
  const { stopLoss, takeProfit, guaranteedStopLoss = false, isDemo = true } = options;

  const payload: Record<string, any> = {
    ctidTraderAccountId,
    positionId,
    guaranteedStopLoss,
  };

  // Only include SL/TP when explicitly provided.
  // Passing 0 removes the level; omitting the field leaves it unchanged.
  if (stopLoss !== undefined) payload.stopLoss = stopLoss;
  if (takeProfit !== undefined) payload.takeProfit = takeProfit;

  return authenticatedRequest(ctidTraderAccountId, PT.AMEND_POSITION_SLTP_REQ, payload, isDemo);
}

/**
 * Modifies a pending (limit/stop) order — volume, prices, SL, or TP.
 *
 * Supply only the fields you want to change. Unspecified optional fields are
 * left at their current values by the cTrader backend.
 *
 * ProtoOA: ProtoOAAmendOrderReq (payloadType 2109)
 */
export async function amendOrder(
  ctidTraderAccountId: number,
  orderId: number,
  options: {
    volumeLots?: number;
    limitPrice?: number;
    stopPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    expirationTimestamp?: number;
    isDemo?: boolean;
  } = {}
): Promise<any> {
  const { volumeLots, limitPrice, stopPrice, stopLoss, takeProfit, expirationTimestamp, isDemo = true } = options;

  const payload: Record<string, any> = {
    ctidTraderAccountId,
    orderId,
  };

  if (volumeLots !== undefined) payload.volume = lotsToCtraderVolume(volumeLots);
  if (limitPrice !== undefined) payload.limitPrice = limitPrice;
  if (stopPrice !== undefined) payload.stopPrice = stopPrice;
  if (stopLoss !== undefined) payload.stopLoss = stopLoss;
  if (takeProfit !== undefined) payload.takeProfit = takeProfit;
  if (expirationTimestamp !== undefined) payload.expirationTimestamp = expirationTimestamp;

  return authenticatedRequest(ctidTraderAccountId, PT.AMEND_ORDER_REQ, payload, isDemo);
}

export async function getSymbolsList(ctidTraderAccountId: number, isDemo: boolean = true): Promise<any[]> {
  const data = await authenticatedRequest(ctidTraderAccountId, PT.SYMBOLS_LIST_REQ, {
    ctidTraderAccountId,
  }, isDemo, { allowEnvironmentFallback: true });
  return data.symbol || [];
}

export async function subscribeToSpots(ctidTraderAccountId: number, symbolId: number, isDemo: boolean = true): Promise<any> {
  const key = `${isDemo ? 'demo' : 'live'}:${ctidTraderAccountId}`;
  const subscription = spotSubscriptions.get(key) || {
    accountId: ctidTraderAccountId,
    symbolIds: new Set<number>(),
    isDemo,
    version: 0,
  };
  if (subscription.symbolIds.has(symbolId)) return { ok: true, symbolId };
  subscription.symbolIds.add(symbolId);
  subscription.version += 1;
  spotSubscriptions.set(key, subscription);
  const version = subscription.version;
  try {
    await startSpotStream(ctidTraderAccountId, isDemo);
    return { ok: true, symbolId };
  } catch (error) {
    // A later subscription superseded this request. Its stream owns the
    // current state, so this older request must not roll it back.
    if (subscription.version === version) {
      subscription.symbolIds.delete(symbolId);
      subscription.version += 1;
      if (subscription.symbolIds.size === 0) spotSubscriptions.delete(key);
    }
    throw error;
  }
}

export async function unsubscribeFromSpots(ctidTraderAccountId: number, symbolId: number, isDemo: boolean = true): Promise<any> {
  const key = `${isDemo ? 'demo' : 'live'}:${ctidTraderAccountId}`;
  const subscription = spotSubscriptions.get(key);
  if (!subscription) return { ok: true, symbolId };
  subscription.symbolIds.delete(symbolId);
  subscription.version += 1;
  if (subscription.symbolIds.size === 0) {
    spotSubscriptions.delete(key);
    spotStreamControllers.get(key)?.abort();
    spotStreamControllers.delete(key);
  } else {
    await startSpotStream(ctidTraderAccountId, isDemo);
  }
  return { ok: true, symbolId };
}

export async function getExpectedMargin(
  ctidTraderAccountId: number,
  symbolId: number,
  volume: number,
  isDemo: boolean = true
): Promise<any> {
  return authenticatedRequest(ctidTraderAccountId, PT.EXPECTED_MARGIN_REQ, {
    ctidTraderAccountId,
    symbolId,
    volume: volume * 100,
  }, isDemo, { allowEnvironmentFallback: true });
}

export function mapTimeframeToCtraderPeriod(tf: string): number {
  const norm = tf.toUpperCase().trim();
  switch (norm) {
    case 'M1': case '1M': case '1m': case 'm1': return 1;
    case 'M2': case '2M': return 2;
    case 'M3': case '3M': return 3;
    case 'M4': case '4M': return 4;
    case 'M5': case '5M': case '5m': case 'm5': return 5;
    case 'M10': case '10M': return 6;
    case 'M15': case '15M': case '15m': case 'm15': return 7;
    case 'M30': case '30M': case '30m': case 'm30': return 8;
    case 'H1': case '1H': case '1h': case 'h1': return 9;
    case 'H4': case '4H': case '4h': case 'h4': return 10;
    case 'D1': case '1D': case '1d': case 'd1': return 11;
    case 'W1': case '1W': case '1w': case 'w1': return 12;
    case 'MN1': case '1MN': case 'MN': return 13;
    default: return 9;
  }
}

export async function getTrendbars(
  ctidTraderAccountId: number,
  symbolId: number,
  period: number,
  fromTimestamp?: number,
  toTimestamp?: number,
  count?: number,
  digits: number = 5,
  isDemo: boolean = true
): Promise<Candle[]> {
  const payload: Record<string, any> = {
    ctidTraderAccountId,
    symbolId,
    period,
  };
  if (fromTimestamp) payload.fromTimestamp = fromTimestamp;
  if (toTimestamp) payload.toTimestamp = toTimestamp;
  if (count) payload.count = count;

  const res = await authenticatedRequest(ctidTraderAccountId, PT.GET_TRENDBARS_REQ, payload, isDemo, { allowEnvironmentFallback: true });

  const divisor = 100000;
  const trendbars = res.trendbar || [];

  const candles: Candle[] = trendbars.map((bar: any) => {
    const lowPrice = Number(bar.low || 0) / divisor;
    const deltaOpen = Number(bar.deltaOpen || 0) / divisor;
    const deltaHigh = Number(bar.deltaHigh || 0) / divisor;
    const deltaClose = Number(bar.deltaClose || 0) / divisor;

    let timeInSeconds = 0;
    if (bar.utcTimestampInMinutes) {
      timeInSeconds = Number(bar.utcTimestampInMinutes) * 60;
    } else if (bar.utcTimestamp) {
      timeInSeconds = Math.floor(Number(bar.utcTimestamp) / 1000);
    } else if (bar.timestamp) {
      timeInSeconds = Math.floor(Number(bar.timestamp) / 1000);
    } else {
      timeInSeconds = Math.floor(Date.now() / 1000);
    }

    return {
      time: timeInSeconds,
      open: Number((lowPrice + deltaOpen).toFixed(digits)),
      high: Number((lowPrice + deltaHigh).toFixed(digits)),
      low: Number(lowPrice.toFixed(digits)),
      close: Number((lowPrice + deltaClose).toFixed(digits)),
    };
  });

  return candles.sort((a, b) => a.time - b.time);
}

// Resolving a symbol costs a full GET_SYMBOLS round-trip on every candle
// fetch, which made timeframe switches feel sluggish. Cache the list per
// account in memory for 10 minutes (symbol definitions rarely change).
const symbolsListCache = new Map<number, { at: number; symbols: any[] }>();
const SYMBOLS_LIST_TTL_MS = 10 * 60 * 1000;

export async function getCachedSymbolsList(ctidTraderAccountId: number, isDemo: boolean = true): Promise<any[]> {
  const hit = symbolsListCache.get(ctidTraderAccountId);
  if (hit && Date.now() - hit.at < SYMBOLS_LIST_TTL_MS) return hit.symbols;
  const symbols = await getSymbolsList(ctidTraderAccountId, isDemo);
  symbolsListCache.set(ctidTraderAccountId, { at: Date.now(), symbols });
  return symbols;
}

export async function fetchCtraderCandles(
  ctidTraderAccountId: number,
  symbolName: string,
  timeframe: string,
  count: number = 500,
  isDemo: boolean = true,
  maxRetries: number = 3,
  fromTimestamp?: number,
  toTimestamp?: number
): Promise<Candle[]> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const symbols = await getCachedSymbolsList(ctidTraderAccountId, isDemo);
      const cleanSym = symbolName.toUpperCase().replace('/', '').replace('_', '');
      const match = symbols.find((s: any) => {
        const sName = (s.symbolName || s.name || '').toUpperCase().replace('/', '').replace('_', '');
        return sName === cleanSym || sName.includes(cleanSym);
      });

      const symbolId = match?.symbolId ? Number(match.symbolId) : 1;
      const digits = match?.digits ? Number(match.digits) : (cleanSym.includes('JPY') ? 3 : 5);
      const period = mapTimeframeToCtraderPeriod(timeframe);

      return await getTrendbars(ctidTraderAccountId, symbolId, period, fromTimestamp, toTimestamp, count, digits, isDemo);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        // Exponential backoff delay (1s, 2s, 4s...)
        await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError;
}
