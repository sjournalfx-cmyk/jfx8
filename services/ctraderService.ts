import { Candle, EADeal, EAPosition } from '../types';

const CTRADER_ID_BASE = 'https://id.ctrader.com';
const WS_DEMO = 'wss://demo.ctraderapi.com:5036';
const WS_LIVE = 'wss://live.ctraderapi.com:5036';

const CLIENT_ID = import.meta.env.VITE_CTRADER_CLIENT_ID || '35508_t8qthF8Rdq0DzmNlxm4WwT0ZlQUggiQaX8uRm6hmQ9xWFz6vmO';
const CLIENT_SECRET = import.meta.env.VITE_CTRADER_CLIENT_SECRET || 'B7zkapjST4jMGqXkEeRm8daHKaGdgrsl88mujeJdicx2xaKlcd';
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

const TOKEN_KEY = 'jfx_ctrader_tokens';
const SCOPE = 'accounts';

// ------------------------------------------------------------------
// Storage helpers — use localStorage with sessionStorage fallback.
// After an OAuth cross-site redirect, some browsers (Safari ITP /
// Firefox ETP) throw "requestStorageAccess: Permission denied" on the
// first localStorage call.  We request access first (no-op on Chrome)
// then fall back to sessionStorage so the tokens are never lost.
// ------------------------------------------------------------------
async function requestStorageIfNeeded(): Promise<void> {
  try {
    if (typeof document.requestStorageAccess === 'function') {
      await document.requestStorageAccess();
    }
  } catch {
    // Permission denied or API not available — fall through to sessionStorage fallback
  }
}

function getStoredTokens(): CtraderTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CtraderTokens;
  } catch {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as CtraderTokens;
    } catch {
      return null;
    }
  }
}

async function storeTokensSafe(tokens: CtraderTokens): Promise<void> {
  await requestStorageIfNeeded();
  const value = JSON.stringify(tokens);
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch {
    // localStorage blocked — persist in sessionStorage for this tab
  }
  try {
    sessionStorage.setItem(TOKEN_KEY, value);
  } catch { /* ignore */ }
}

function storeTokens(tokens: CtraderTokens) {
  const value = JSON.stringify(tokens);
  try { localStorage.setItem(TOKEN_KEY, value); } catch { /* blocked */ }
  try { sessionStorage.setItem(TOKEN_KEY, value); } catch { /* blocked */ }
}

function clearTokens() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* blocked */ }
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* blocked */ }
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

export function addCtraderListener(listener: CtraderEventListener) {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

async function ensureConnected(isDemo: boolean = true): Promise<WebSocket> {
  const existingWs = isDemo ? wsDemo : wsLive;
  if (existingWs && existingWs.readyState === WebSocket.OPEN) return existingWs;

  // If a connection is already being established, piggyback on that promise
  // This prevents concurrent callers from each opening (and closing) their own socket
  const activePromise = isDemo ? connectPromiseDemo : connectPromiseLive;
  if (activePromise) return activePromise;

  const newPromise: Promise<WebSocket> = (async () => {
    const tokens = getStoredTokens();
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
            pending.reject(new Error(msg.payload?.errorCode || 'cTrader error'));
          } else {
            pending.resolve(msg.payload);
          }
        }

        // Broadcast to registered event listeners
        for (const listener of eventListeners) {
          try { listener(msg.payloadType, msg.payload, isDemo); } catch { /* ignore listener errors */ }
        }
      } catch { /* ignore parse errors */ }
    };

    return socket;
  })();

  if (isDemo) connectPromiseDemo = newPromise;
  else connectPromiseLive = newPromise;

  return newPromise;
}


function sendWsMessage(socket: WebSocket, payloadType: number, payload: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const clientMsgId = nextMsgId();
    pendingReqs.set(clientMsgId, { resolve, reject, payloadType });
    const msg = JSON.stringify({
      clientMsgId,
      payloadType,
      payload,
    });
    socket.send(msg);
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
  const redirectUri = `${window.location.origin}/api/ctrader/callback`;
  const url = new URL(`${CTRADER_ID_BASE}/my/settings/openapi/grantingaccess/`);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('product', 'web');
  return url.toString();
}

export async function exchangeCode(code: string): Promise<{ ok: boolean; error?: string }> {
  const redirectUri = `${window.location.origin}/api/ctrader/callback`;
  try {
    const res = await fetch(`/api/ctrader/exchange?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || data?.errorCode || `HTTP ${res.status}`;
      console.warn('[cTrader] exchange failed:', msg, data);
      return { ok: false, error: String(msg) };
    }
    if (data.accessToken && data.refreshToken) {
      await storeTokensSafe({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (data.expiresIn || 2628000) * 1000,
      });
      return { ok: true };
    }
    return { ok: false, error: data?.error || 'No tokens in response' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}


export function isAuthenticated(): boolean {
  const tokens = getStoredTokens();
  if (!tokens) return false;
  return Date.now() < tokens.expiresAt;
}

export async function refreshToken(): Promise<boolean> {
  const tokens = getStoredTokens();
  if (!tokens?.refreshToken) return false;

  try {
    const res = await fetch('/api/ctrader/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    storeTokens({
      accessToken: data.accessToken || data.access_token,
      refreshToken: data.refreshToken || data.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + (data.expiresIn || data.expires_in || 2628000) * 1000,
    });
    return true;
  } catch {
    return false;
  }
}

export function logout() {
  clearTokens();
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

export async function getAccounts(): Promise<CtraderAccount[]> {
  let tokens = getStoredTokens();
  if (!tokens) throw new Error('Not authenticated with cTrader');

  // Auto-refresh if expired
  if (Date.now() >= tokens.expiresAt) {
    const refreshed = await refreshToken();
    if (!refreshed) throw new Error('cTrader session expired. Please reconnect.');
    tokens = getStoredTokens();
    if (!tokens) throw new Error('cTrader session expired. Please reconnect.');
  }

  const res = await fetch('/api/ctrader/accounts', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Server returned ${res.status}`);
  }

  const data = await res.json();
  return dedupeAccountsByTraderId((data.accounts || []) as CtraderAccount[]);
}
export async function authAccount(ctidTraderAccountId: number, isDemo: boolean = true): Promise<void> {
  let tokens = getStoredTokens();
  if (!tokens) throw new Error('Not authenticated with cTrader');

  // Auto-refresh if expired
  if (Date.now() >= tokens.expiresAt) {
    const refreshed = await refreshToken();
    if (!refreshed) throw new Error('cTrader session expired. Please reconnect.');
    tokens = getStoredTokens();
    if (!tokens) throw new Error('cTrader session expired. Please reconnect.');
  }

  const socket = await ensureConnected(isDemo);

  // 1. Application Auth (Single execution per socket)
  let appPromise = appAuthPromises.get(socket);
  if (!appPromise) {
    appPromise = (async () => {
      if (!appAuthDone.has(socket)) {
        await sendWsMessage(socket, PT.APPLICATION_AUTH_REQ, {
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
        });
        appAuthDone.add(socket);
      }
    })();
    appAuthPromises.set(socket, appPromise);
  }
  await appPromise;

  // 2. Account Auth (Single execution per socket + accountId)
  let socketAccountMap = accountAuthPromises.get(socket);
  if (!socketAccountMap) {
    socketAccountMap = new Map<number, Promise<void>>();
    accountAuthPromises.set(socket, socketAccountMap);
  }

  let accPromise = socketAccountMap.get(ctidTraderAccountId);
  if (!accPromise) {
    accPromise = (async () => {
      await sendWsMessage(socket, PT.ACCOUNT_AUTH_REQ, {
        ctidTraderAccountId,
        accessToken: tokens.accessToken,
      });
    })();
    socketAccountMap.set(ctidTraderAccountId, accPromise);
  }
  await accPromise;
}
export async function getPositions(ctidTraderAccountId: number, isDemo: boolean = true): Promise<CtraderPosition[]> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);

  // Use ProtoOAReconcileReq (2124) — returns current open positions + pending orders
  const data = await sendWsMessage(socket, PT.RECONCILE_REQ, {
    ctidTraderAccountId,
  });

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

export async function getClosedDeals(ctidTraderAccountId: number, fromTimestamp?: number, toTimestamp?: number, isDemo: boolean = true): Promise<CtraderDeal[]> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);

  const payload: Record<string, any> = {
    ctidTraderAccountId,
  };
  // cTrader expects timestamps in MILLISECONDS
  if (fromTimestamp) payload.fromTimestamp = fromTimestamp;
  if (toTimestamp) payload.toTimestamp = toTimestamp;

  const data = await sendWsMessage(socket, PT.DEAL_LIST_REQ, payload);

  return (data.deal || []).map((deal: any) => {
    const tradeData = deal.tradeData || {};
    const rawSymbolId = deal.symbolId ?? tradeData.symbolId ?? deal.closePositionDetail?.symbolId;
    const symbolId = rawSymbolId !== undefined && rawSymbolId !== null ? Number(rawSymbolId) : undefined;

    return {
      dealId: Number(deal.dealId),
      orderId: Number(deal.orderId ?? 0),
      symbol: deal.symbolName || deal.symbol || tradeData.symbolName || tradeData.symbol || '',
      symbolId: typeof symbolId === 'number' && Number.isFinite(symbolId) ? symbolId : undefined,
      tradeSide: deal.tradeSide === 1 ? 'buy' : 'sell',
      volume: Number(deal.filledVolume ?? deal.volume ?? 0) / 10000000,
      price: Number(deal.executionPrice ?? deal.price ?? 0),
      profit: Number(deal.closePositionDetail?.grossProfit ?? deal.profit ?? 0) / 100,
      swap: Number(deal.closePositionDetail?.swap ?? deal.swap ?? 0) / 100,
      commission: Number(deal.commission ?? 0) / 100,
      openTimestamp: deal.createTimestamp ? new Date(Number(deal.createTimestamp)).toISOString() : '',
      closeTimestamp: deal.executionTimestamp ? new Date(Number(deal.executionTimestamp)).toISOString()
        : deal.createTimestamp ? new Date(Number(deal.createTimestamp)).toISOString() : '',
      stopLoss: deal.closePositionDetail?.stopLoss ? Number(deal.closePositionDetail.stopLoss) : undefined,
      takeProfit: deal.closePositionDetail?.takeProfit ? Number(deal.closePositionDetail.takeProfit) : undefined,
      entryPrice: deal.closePositionDetail?.entryPrice ? Number(deal.closePositionDetail.entryPrice) : undefined,
    };
  });
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
  const tokens = getStoredTokens();
  if (!tokens) throw new Error('Not authenticated with cTrader');
  const socket = await ensureConnected(true);
  const data = await sendWsMessage(socket, PT.GET_CTID_PROFILE_BY_TOKEN_REQ, {
    accessToken: tokens.accessToken,
  });
  return data.profile;
}

export async function getTrader(ctidTraderAccountId: number, isDemo: boolean = true): Promise<any> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  const data = await sendWsMessage(socket, PT.TRADER_REQ, {
    ctidTraderAccountId,
  });
  return data.trader;
}

export async function getPendingOrders(ctidTraderAccountId: number, isDemo: boolean = true): Promise<CtraderOrder[]> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  const data = await sendWsMessage(socket, PT.RECONCILE_REQ, {
    ctidTraderAccountId,
  });
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

export async function createNewOrder(
  ctidTraderAccountId: number,
  symbolId: number,
  tradeSide: 'buy' | 'sell',
  volume: number,
  limitPrice?: number,
  stopPrice?: number,
  isDemo: boolean = true
): Promise<any> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  
  let orderType = 1; // 1=MARKET, 2=LIMIT, 3=STOP, 4=STOP_LIMIT
  if (limitPrice && stopPrice) orderType = 4;
  else if (limitPrice) orderType = 2;
  else if (stopPrice) orderType = 3;

  const payload: Record<string, any> = {
    ctidTraderAccountId,
    symbolId,
    orderType,
    tradeSide: tradeSide === 'buy' ? 1 : 2,
    volume: unitsToCtraderVolume(volume),
  };

  if (limitPrice) payload.limitPrice = limitPrice;
  if (stopPrice) payload.stopPrice = stopPrice;

  return sendWsMessage(socket, PT.NEW_ORDER_REQ, payload);
}

export async function closePosition(
  ctidTraderAccountId: number,
  positionId: number,
  volume: number,
  isDemo: boolean = true
): Promise<any> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  return sendWsMessage(socket, PT.CLOSE_POSITION_REQ, {
    ctidTraderAccountId,
    positionId,
    volume: lotsToCtraderVolume(volume),
  });
}

export async function cancelOrder(
  ctidTraderAccountId: number,
  orderId: number,
  isDemo: boolean = true
): Promise<any> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  return sendWsMessage(socket, PT.CANCEL_ORDER_REQ, {
    ctidTraderAccountId,
    orderId,
  });
}

export async function getSymbolsList(ctidTraderAccountId: number, isDemo: boolean = true): Promise<any[]> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  const data = await sendWsMessage(socket, PT.SYMBOLS_LIST_REQ, {
    ctidTraderAccountId,
  });
  return data.symbol || [];
}

export async function subscribeToSpots(ctidTraderAccountId: number, symbolId: number, isDemo: boolean = true): Promise<any> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  return sendWsMessage(socket, PT.SUBSCRIBE_SPOTS_REQ, {
    ctidTraderAccountId,
    symbolId: [symbolId],
  });
}

export async function unsubscribeFromSpots(ctidTraderAccountId: number, symbolId: number, isDemo: boolean = true): Promise<any> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  return sendWsMessage(socket, PT.UNSUBSCRIBE_SPOTS_REQ, {
    ctidTraderAccountId,
    symbolId: [symbolId],
  });
}

export async function getExpectedMargin(
  ctidTraderAccountId: number,
  symbolId: number,
  volume: number,
  isDemo: boolean = true
): Promise<any> {
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);
  return sendWsMessage(socket, PT.EXPECTED_MARGIN_REQ, {
    ctidTraderAccountId,
    symbolId,
    volume: volume * 100,
  });
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
  const socket = await ensureConnected(isDemo);
  await authAccount(ctidTraderAccountId, isDemo);

  const payload: Record<string, any> = {
    ctidTraderAccountId,
    symbolId,
    period,
  };
  if (fromTimestamp) payload.fromTimestamp = fromTimestamp;
  if (toTimestamp) payload.toTimestamp = toTimestamp;
  if (count) payload.count = count;

  const res = await sendWsMessage(socket, PT.GET_TRENDBARS_REQ, payload);

  const divisor = Math.pow(10, digits);
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
      const symbols = await getSymbolsList(ctidTraderAccountId, isDemo);
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
