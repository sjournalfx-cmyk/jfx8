import { supabase } from '../lib/supabase';
import { persistentGetSync, persistentSet } from '../lib/persistentStore';
import { Trade, Note, DailyBias, UserProfile, Goal, StrategyDiagram, DBTrade, DBGoal, BacktestSession, CashTransaction, DBCashTransaction, Portfolio, PortfolioAccount } from '../types';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from '../lib/constants';
import { normalizeTrade } from '../lib/trade-normalization';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toStringArray = (value: unknown, fallback: string[] = []): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
};

const toSafeString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const sanitizeTimestamp = (value: unknown): string | null => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const timestamp = Date.parse(trimmed);
  if (isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
};


/**
 * Foreign-key rejection on portfolio_id (e.g. a stray
 * trades_portfolio_id_fkey pointing at a portfolios table that doesn't
 * hold client-generated ids like 'default' or local UUIDs).
 * portfolio_id is plain text by design — no FK must exist — so the fix is
 * to strip it and retry, keeping the localStorage overlay as the assignment.
 */
export const isPortfolioFkViolation = (error: any): boolean => {
  if (!error) return false;
  const code = String((error as any).code || '');
  const msg = String(
    (error as any).message || (error as any).details || (error as any).hint || ''
  ).toLowerCase();
  return code === '23503' && msg.includes('portfolio');
};

const stripPortfolioId = <T extends Record<string, any>>(data: T): T => {
  if (data && typeof data === 'object' && 'portfolio_id' in data) {
    const { portfolio_id: _drop, ...rest } = data;
    return rest as T;
  }
  return data;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const isUniqueViolation = (error: any) => error?.code === '23505' || /duplicate key/i.test(String(error?.message || ''));

const TRADE_LIST_COLUMNS = [
  'id', 'ticket_id', 'pair', 'asset_type', 'date', 'time', 'session', 'direction',
  'entry_price', 'exit_price', 'stop_loss', 'take_profit', 'lots', 'result', 'pnl',
  'commissions', 'fees', 'swap', 'rr', 'rating', 'tags', 'notes', 'emotions',
  'plan_adherence', 'trading_mistake', 'mindset', 'exit_comment', 'voice_note',
  'open_time', 'close_time', 'before_screenshot', 'after_screenshot', 'setup_id',
  'setup_name', 'deleted_at', 'chart_timeframe', 'updated_at', 'portfolio_id',
].join(',');
// Fallback column list for bulletproof reads (see getTrades). Kept adjacent
// to the primary list so the two cannot drift apart.
const TRADE_LIST_COLUMNS_WITHOUT_PORTFOLIO = TRADE_LIST_COLUMNS.split(',').filter(c => c !== 'portfolio_id').join(',');
// Discipline engine columns (migration 20260921). Appended last so the
// pre-migration fallback in getTrades can strip exactly these.
const DISCIPLINE_COLUMNS = [
  'checklist_template_id', 'checklist_checks', 'adherence_rate', 'execution_grade', 'behavior_tags',
];
const TRADE_LIST_COLUMNS_WITH_DISCIPLINE = [...TRADE_LIST_COLUMNS.split(','), ...DISCIPLINE_COLUMNS].join(',');

// Last getTrades failure (null on success). Surfaced in Diagnostics so a
// silently-empty History is always explainable. Module-level by design:
// dataService is a singleton.
let lastTradesLoadError: string | null = null;
const setLastTradesLoadError = (msg: string | null) => { lastTradesLoadError = msg; };
export const getLastTradesLoadError = (): string | null => lastTradesLoadError;

const tradePortfolioKey = (userId: string) => `jfx_trade_portfolios_${userId}`;

export const getTradePortfolioKey = tradePortfolioKey;

export const readTradePortfolioOverlay = (userId: string): Record<string, string> => {
  try {
    if (typeof window === 'undefined') return {};
    // Sync mirror (localStorage + in-memory) — hydrated from native
    // Preferences at boot via hydrateUserKeysFromNative. Never async here:
    // this runs per-row during getTrades mapping.
    const raw = persistentGetSync(tradePortfolioKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
};

export const writeTradePortfolioOverlay = (userId: string, tradeId: string, portfolioId: string) => {
  writeTradePortfolioOverlays(userId, { [tradeId]: portfolioId });
};

/** Bulk version: one localStorage read-modify-write for many assignments. */
export const writeTradePortfolioOverlays = (userId: string, entries: Record<string, string>) => {
  try {
    if (typeof window === 'undefined' || !userId) return;
    const overlay = readTradePortfolioOverlay(userId);
    let touched = false;
    for (const [tradeId, portfolioId] of Object.entries(entries)) {
      if (tradeId && portfolioId) {
        overlay[tradeId] = portfolioId;
        touched = true;
      }
    }
    if (!touched) return;
    const keys = Object.keys(overlay).slice(-2000);
    const capped: Record<string, string> = {};
    for (const k of keys) capped[k] = overlay[k];
    // Dual-write: sync mirror + durable native copy (survives APK restarts).
    persistentSet(tradePortfolioKey(userId), JSON.stringify(capped));
  } catch { /* storage blocked — non-fatal */ }
};

/** Remove overlay assignments (e.g. after bulk delete) in one write. */
export const removeTradePortfolioOverlays = (userId: string, tradeIds: string[]) => {
  try {
    if (typeof window === 'undefined' || !userId || tradeIds.length === 0) return;
    const overlay = readTradePortfolioOverlay(userId);
    let touched = false;
    for (const id of tradeIds) {
      if (id in overlay) {
        delete overlay[id];
        touched = true;
      }
    }
    if (!touched) return;
    persistentSet(tradePortfolioKey(userId), JSON.stringify(overlay));
  } catch { /* storage blocked — non-fatal */ }
};

export const reassignTradePortfolioOverlay = (userId: string, fromPortfolioId: string, toPortfolioId: string) => {
  try {
    if (typeof window === 'undefined' || !userId || !fromPortfolioId) return;
    const overlay = readTradePortfolioOverlay(userId);
    let modified = false;
    for (const [tradeId, pid] of Object.entries(overlay)) {
      if (pid === fromPortfolioId) {
        overlay[tradeId] = toPortfolioId;
        modified = true;
      }
    }
    if (modified) {
      persistentSet(tradePortfolioKey(userId), JSON.stringify(overlay));
    }
  } catch { /* ignore */ }
};

export const clearTradePortfolioOverlayForPortfolio = (userId: string, portfolioId: string) => {
  try {
    if (typeof window === 'undefined' || !userId || !portfolioId) return;
    const overlay = readTradePortfolioOverlay(userId);
    let modified = false;
    for (const [tradeId, pid] of Object.entries(overlay)) {
      if (pid === portfolioId) {
        delete overlay[tradeId];
        modified = true;
      }
    }
    if (modified) {
      persistentSet(tradePortfolioKey(userId), JSON.stringify(overlay));
    }
  } catch { /* ignore */ }
};

const withClientPortfolio = <T extends Trade>(trade: T, portfolioId?: string): T => {
  if (portfolioId) (trade as Trade).portfolio_id = portfolioId;
  return trade;
};

/**
 * Canonical test to determine if a trade belongs to a given portfolio.
 * - 'all': matches every trade.
 * - Default portfolio ('default' or defaultPortfolioId UUID): matches trades with
 *   no portfolio_id, 'default', or defaultPortfolioId.
 * - Custom portfolio: matches trades whose portfolio_id strictly matches targetPortfolioId.
 */
export const isTradeInPortfolio = (
  tradePortfolioId: string | null | undefined,
  targetPortfolioId: string | null | undefined,
  defaultPortfolioId: string | null | undefined
): boolean => {
  if (!targetPortfolioId || targetPortfolioId === 'all') return true;

  const defId = defaultPortfolioId || 'default';
  const isTargetDefault = targetPortfolioId === 'default' || targetPortfolioId === defId;
  const isTradeDefault = !tradePortfolioId || tradePortfolioId === 'default' || tradePortfolioId === defId;

  if (isTargetDefault) {
    return isTradeDefault;
  }
  return tradePortfolioId === targetPortfolioId;
};

// ─── Portfolios: server sync (migration 20260921) with overlay fallback ───
// Every function degrades gracefully when offline or when the table hasn't
// been created yet (callers already try/catch): overlay + local cache keep
// the UI working, and ids are client-generated UUIDs preserved server-side
// so trades.portfolio_id stays valid across uninstall/reinstall.
const PORTFOLIO_OFFLINE_CODE = 'PORTFOLIO_OFFLINE';

const portfolioOffline = (detail?: string) => {
  const err = new Error(detail || 'Portfolio server sync unavailable (PORTFOLIO_OFFLINE)');
  (err as any).code = PORTFOLIO_OFFLINE_CODE;
  throw err;
};

/** True when the portfolios table isn't reachable (vs a real failure). */
const isPortfolioSyncUnavailable = (error: any): boolean => {
  if (!error) return false;
  const code = String((error as any).code || '');
  if (code === PORTFOLIO_OFFLINE_CODE || code === 'PGRST205' || code === '42P01') return true;
  const msg = String((error as any).message || (error as any).details || (error as any).hint || '').toLowerCase();
  return (
    msg.includes('does not exist') ||
    (msg.includes('portfolios') && (msg.includes('schema cache') || msg.includes('relation')))
  );
};

interface DBPortfolio {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  purpose?: string | null;
  source?: string | null;
  starting_balance?: number | null;
  currency?: string | null;
  is_default?: boolean | null;
  is_archived?: boolean | null;
  accounts?: PortfolioAccount[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const mapPortfolioFromDB = (row: DBPortfolio): Portfolio => ({
  id: row.id,
  name: row.name || 'Portfolio',
  description: row.description || undefined,
  purpose: (row.purpose as Portfolio['purpose']) || undefined,
  source: (row.source as Portfolio['source']) || 'manual',
  startingBalance: row.starting_balance !== null && row.starting_balance !== undefined ? Number(row.starting_balance) : undefined,
  currency: row.currency || undefined,
  isDefault: Boolean(row.is_default),
  isArchived: Boolean(row.is_archived),
  accounts: Array.isArray(row.accounts) ? row.accounts : [],
  createdAt: row.created_at || new Date().toISOString(),
  updatedAt: row.updated_at || undefined,
});

const buildPortfolioDbPayload = (userId: string, p: Portfolio): Record<string, unknown> => ({
  // Preserve the client-generated UUID so existing trades.portfolio_id
  // values keep matching after reinstalls. The seed 'default' is NOT a
  // UUID — callers translate it before insert (see insertPortfolio).
  id: p.id,
  user_id: userId,
  name: p.name,
  description: p.description || null,
  purpose: p.purpose || null,
  source: p.source || 'manual',
  starting_balance: p.startingBalance ?? null,
  currency: p.currency || null,
  is_default: Boolean(p.isDefault),
  is_archived: Boolean(p.isArchived),
  accounts: p.accounts || [],
});

export const fetchPortfolios = async (userId: string): Promise<Portfolio[]> => {
  const { data, error } = await supabase
    .from('portfolios')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) return portfolioOffline(`fetchPortfolios: ${error.message || error.code}`);
  return (data || []).map((row: any) => mapPortfolioFromDB(row as DBPortfolio));
};

export const insertPortfolio = async (userId: string, draft: Portfolio): Promise<Portfolio> => {
  // The local seed id 'default' is not a UUID and can never be a PK.
  // Server rows always get real UUIDs; callers remap draft→saved ids.
  const payload = buildPortfolioDbPayload(userId, draft);
  if (draft.id === 'default' || !/^[0-9a-f-]{36}$/i.test(String(draft.id))) {
    delete (payload as Record<string, unknown>).id;
  }
  const { data, error } = await supabase
    .from('portfolios')
    .insert(payload)
    .select()
    .single();
  if (error) return portfolioOffline(`insertPortfolio: ${error.message || error.code}`);
  return mapPortfolioFromDB(data as DBPortfolio);
};

export const patchPortfolio = async (id: string, patch: Partial<Portfolio>): Promise<void> => {
  if (id === 'default') return; // seed has no server row
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return portfolioOffline('patchPortfolio: not authenticated');
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.description !== undefined) payload.description = patch.description || null;
  if (patch.purpose !== undefined) payload.purpose = patch.purpose || null;
  if (patch.source !== undefined) payload.source = patch.source || 'manual';
  if (patch.startingBalance !== undefined) payload.starting_balance = patch.startingBalance ?? null;
  if (patch.currency !== undefined) payload.currency = patch.currency || null;
  if (patch.isDefault !== undefined) payload.is_default = Boolean(patch.isDefault);
  if (patch.isArchived !== undefined) payload.is_archived = Boolean(patch.isArchived);
  if (patch.accounts !== undefined) payload.accounts = patch.accounts || [];
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase
    .from('portfolios')
    .update(payload)
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return portfolioOffline(`patchPortfolio: ${error.message || error.code}`);
};

export const deletePortfolioRow = async (id: string): Promise<void> => {
  if (id === 'default') return; // seed has no server row
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return portfolioOffline('deletePortfolioRow: not authenticated');
  // Soft-archive, never hard-delete: trades referencing this id (e.g. from
  // an offline window) keep resolving instead of orphaning.
  const { error } = await supabase
    .from('portfolios')
    .update({ is_archived: true })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return portfolioOffline(`deletePortfolioRow: ${error.message || error.code}`);
};

export const reassignTradesPortfolio = async (userId: string, fromId: string, toId: string): Promise<void> => {
  // Overlay first (instant local consistency), server second (durability).
  if (userId && fromId && toId) {
    reassignTradePortfolioOverlay(userId, fromId, toId);
  }
  const { error: moveError } = await supabase
    .from('trades')
    .update({ portfolio_id: toId })
    .eq('user_id', userId)
    .eq('portfolio_id', fromId);
  if (moveError) {
    if (isPortfolioFkViolation(moveError)) {
      // Stray FK on trades.portfolio_id must not block deletes of
      // portfolios; the overlay already reassigned locally.
      console.warn('reassignTradesPortfolio: portfolio_id FK blocked server move; overlay kept.');
      return;
    }
    if (isPortfolioSyncUnavailable(moveError) || extractMissingColumnName(moveError)) {
      return portfolioOffline(`reassignTradesPortfolio: ${moveError.message || moveError.code}`);
    }
    throw moveError;
  }
};

export const backfillNullTradesToPortfolio = async (userId: string, portfolioId: string): Promise<void> => {
  // Reconcile local overlay entries from 'default' to portfolioId as well
  if (userId && portfolioId && portfolioId !== 'default') {
    reassignTradePortfolioOverlay(userId, 'default', portfolioId);
  }
  // Covers both never-assigned rows (NULL) and rows stamped with the legacy
  // local seed id 'default' from before server sync existed — both belong to
  // the resolved Default once the server Default has a real UUID.
  const { error } = await supabase
    .from('trades')
    .update({ portfolio_id: portfolioId })
    .eq('user_id', userId)
    .or('portfolio_id.is.null,portfolio_id.eq.default');
  if (error) {
    if (isPortfolioSyncUnavailable(error) || isPortfolioFkViolation(error)) return; // best-effort
    const missing = extractMissingColumnName(error);
    if (missing) return; // column/table not migrated yet — overlay covers
    throw error;
  }
};

export const extractMissingColumnName = (error: any): string | null => {
  if (!error) return null;
  const message = String(error.message || error.details || error.hint || '');
  const status = Number(error.status || error.statusCode || 0);
  const code = String(error.code || '');

  const isColumnError =
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST200' ||
    status === 400 ||
    message.toLowerCase().includes('column') ||
    message.toLowerCase().includes('schema cache');

  if (!isColumnError) return null;

  const patterns = [
    // Postgres 42703 passthrough: `column trades.commissions does not exist`
    // (optionally quoted, optionally table-prefixed) — must come before the
    // generic catch-alls below so we get the column, not the table name.
    /column\s+(.+?)\s+does not exist/i,
    /Could not find the '([^']+)' column/i,
    /column "([^"]+)" of relation/i,
    /column "([^"]+)" does not exist/i,
    /column "([^"]+)"/i,
    /column ([a-zA-Z0-9_]+) of/i,
    /'([^']+)' column/i,
    /relation [^ ]+ does not have a column ([a-zA-Z0-9_]+)/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      // Normalize `"trades"."commissions"` / `trades.commissions` → `commissions`
      // so callers can compare against bare snake_case column keys.
      return match[1].replace(/["']/g, '').trim().split('.').pop() || null;
    }
  }

  return null;
};

// Helper to map DB Trade to App Trade
export const mapTradeFromDB = (dbTrade: DBTrade): Trade => normalizeTrade({
  id: dbTrade.id,
  updatedAt: dbTrade.updated_at,
  ticketId: dbTrade.ticket_id || undefined,
  pair: dbTrade.pair || '',
  assetType: dbTrade.asset_type || 'Forex',
  date: dbTrade.date || '',
  time: dbTrade.time || '',
  session: dbTrade.session || 'London Session',
  direction: dbTrade.direction || 'Long',
  entryPrice: toFiniteNumber(dbTrade.entry_price, 0),
  exitPrice: dbTrade.exit_price !== undefined && dbTrade.exit_price !== null ? toFiniteNumber(dbTrade.exit_price, 0) : undefined,
  stopLoss: toFiniteNumber(dbTrade.stop_loss, 0),
  takeProfit: toFiniteNumber(dbTrade.take_profit, 0),
  lots: toFiniteNumber(dbTrade.lots, 0),
  result: dbTrade.result || 'Pending',
  pnl: toFiniteNumber(dbTrade.pnl, 0),
  commissions: dbTrade.commissions !== undefined ? toFiniteNumber(dbTrade.commissions, 0) : undefined,
  fees: dbTrade.fees !== undefined ? toFiniteNumber(dbTrade.fees, 0) : undefined,
  swap: dbTrade.swap !== undefined ? toFiniteNumber(dbTrade.swap, 0) : undefined,
  rr: toFiniteNumber(dbTrade.rr, 0),
  rating: toFiniteNumber(dbTrade.rating, 0),
  tags: dbTrade.tags || [],
  notes: dbTrade.notes || undefined,
  emotions: dbTrade.emotions || [],
  planAdherence: dbTrade.plan_adherence,
  tradingMistake: dbTrade.trading_mistake,
  mindset: dbTrade.mindset,
  exitComment: dbTrade.exit_comment,
  voiceNote: dbTrade.voice_note,
  openTime: dbTrade.open_time,
  closeTime: dbTrade.close_time,
  beforeScreenshot: dbTrade.before_screenshot,
  afterScreenshot: dbTrade.after_screenshot,
  setupId: dbTrade.setup_id,
  setupName: dbTrade.setup_name,
  deletedAt: dbTrade.deleted_at,
  chartCandles: dbTrade.chart_candles || undefined,
  chartTimeframe: dbTrade.chart_timeframe || undefined,
  checklistTemplateId: (dbTrade as DBTrade).checklist_template_id || undefined,
  checklistChecks: ((dbTrade as DBTrade).checklist_checks && typeof (dbTrade as DBTrade).checklist_checks === 'object'
    ? (dbTrade as DBTrade).checklist_checks as Record<string, boolean>
    : undefined),
  adherenceRate: typeof (dbTrade as DBTrade).adherence_rate === 'number' && Number.isFinite((dbTrade as DBTrade).adherence_rate as number)
    ? (dbTrade as DBTrade).adherence_rate as number
    : undefined,
  executionGrade: ['A', 'B', 'C', 'D', 'F'].includes((dbTrade as DBTrade).execution_grade as string)
    ? (dbTrade as DBTrade).execution_grade as Trade['executionGrade']
    : undefined,
  behaviorTags: Array.isArray((dbTrade as DBTrade).behavior_tags)
    ? ((dbTrade as DBTrade).behavior_tags as unknown[]).map(t => String(t)).filter(Boolean)
    : undefined,
});

const mapNoteFromDB = (note: any): Note => ({
  ...note,
  isPinned: note.is_pinned,
  isArchived: note.is_archived,
  isTrashed: note.is_trashed,
  isList: note.is_list,
  listItems: note.list_items,
  tableData: note.table_data,
  date: note.date || note.created_at,
  position: note.position,
  updatedAt: note.updated_at,
});

// Helper to map App Trade to DB Trade
const buildTradeDbPayload = (trade: Partial<Trade>, userId: string, fallback: Partial<Trade> = {}): Partial<DBTrade> => {
  const merged = normalizeTrade(
    {
      ...fallback,
      ...trade,
      id: toSafeString(trade.id, toSafeString(fallback.id, crypto.randomUUID())),
    },
    fallback
  );

  return {
    ...(isUuid(merged.id) ? { id: merged.id } : {}),
    user_id: userId,
    ticket_id: merged.ticketId,
    pair: merged.pair,
    asset_type: merged.assetType,
    date: merged.date,
    time: merged.time,
    session: merged.session,
    direction: merged.direction,
    entry_price: merged.entryPrice,
    exit_price: merged.exitPrice,
    stop_loss: merged.stopLoss,
    take_profit: merged.takeProfit,
    lots: merged.lots,
    result: merged.result,
    pnl: merged.pnl,
    commissions: merged.commissions,
    fees: merged.fees,
    swap: merged.swap,
    rr: merged.rr,
    rating: merged.rating,
    tags: merged.tags,
    notes: merged.notes,
    emotions: merged.emotions,
    plan_adherence: merged.planAdherence,
    trading_mistake: merged.tradingMistake,
    mindset: merged.mindset,
    exit_comment: merged.exitComment,
    voice_note: merged.voiceNote,
    open_time: sanitizeTimestamp(merged.openTime),
    close_time: sanitizeTimestamp(merged.closeTime),
    before_screenshot: merged.beforeScreenshot,
    after_screenshot: merged.afterScreenshot,
    setup_id: merged.setupId || null,
    setup_name: merged.setupName || null,
    deleted_at: merged.deletedAt,
    ...(Object.prototype.hasOwnProperty.call(trade, 'chartCandles')
      ? { chart_candles: merged.chartCandles || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(trade, 'chartTimeframe')
      ? { chart_timeframe: merged.chartTimeframe || null }
      : {}),
    // Discipline engine snapshot — only sent when the trade carries it, so
    // pre-migration servers keep working (extractMissingColumnName strips the
    // rest on column errors, same as chart columns).
    ...(Object.prototype.hasOwnProperty.call(trade, 'checklistTemplateId')
      ? { checklist_template_id: merged.checklistTemplateId || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(trade, 'checklistChecks')
      ? { checklist_checks: merged.checklistChecks && Object.keys(merged.checklistChecks).length ? merged.checklistChecks : null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(trade, 'adherenceRate')
      ? { adherence_rate: typeof merged.adherenceRate === 'number' && Number.isFinite(merged.adherenceRate) ? merged.adherenceRate : null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(trade, 'executionGrade')
      ? { execution_grade: merged.executionGrade || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(trade, 'behaviorTags')
      ? { behavior_tags: merged.behaviorTags && merged.behaviorTags.length ? merged.behaviorTags : null }
      : {}),
  };
};

// Helper to map DB Cash Transaction to App Cash Transaction
export const mapCashTransactionFromDB = (dbTx: DBCashTransaction): CashTransaction => ({
  id: dbTx.id,
  type: dbTx.type,
  amount: normalizeCashTransactionAmount({
    type: dbTx.type,
    amount: Number(dbTx.amount || 0),
  } as CashTransaction),
  date: dbTx.date,
  description: dbTx.description,
});

const normalizeCashTransactionAmount = (tx: Pick<CashTransaction, 'type' | 'amount'>) => {
  const amount = Number(tx.amount || 0);
  if (!Number.isFinite(amount)) return 0;

  switch (tx.type) {
    case 'Deposit':
    case 'Interest':
    case 'Promotion':
      return Math.abs(amount);
    case 'Withdrawal':
    case 'Fee':
    case 'Tax':
      return -Math.abs(amount);
    case 'Transfer':
    default:
      return amount;
  }
};

const CASH_TRANSACTION_CACHE_PREFIX = 'jfx_cash_transactions_cache_';
const CASH_TRANSACTION_TOMBSTONE_PREFIX = 'jfx_cash_tx_tombstones_';
const CASH_TRANSACTION_UNSYNCED_PREFIX = 'jfx_cash_tx_unsynced_';
const CASH_TX_RETRY_DELAY_MS = 2 * 60 * 1000; // retry the backend 2 min after a failure
// Module-level flag with automatic recovery — never a permanent kill-switch.
let cashTransactionsBackendUnavailableAt = 0;

const cashBackendAvailable = () =>
  !cashTransactionsBackendUnavailableAt || Date.now() - cashTransactionsBackendUnavailableAt > CASH_TX_RETRY_DELAY_MS;

const getCashTransactionCacheKey = (userId: string) => `${CASH_TRANSACTION_CACHE_PREFIX}${userId}`;
const getCashTransactionTombstoneKey = (userId: string) => `${CASH_TRANSACTION_TOMBSTONE_PREFIX}${userId}`;
const getCashTransactionUnsyncedKey = (userId: string) => `${CASH_TRANSACTION_UNSYNCED_PREFIX}${userId}`;

/**
 * A stable signature for duplicate/ghost detection. Used for tombstones so an
 * intentionally deleted transaction can NEVER resurrect from a stale cache or
 * a refetch race, regardless of which id it carries.
 */
export const cashTransactionSignature = (tx: Pick<CashTransaction, 'type' | 'amount' | 'date' | 'description'>) => {
  const marker = tx.description?.match(/\[CW:(\d+)\]/)?.[1];
  if (marker) return `cw:${marker}`;
  return `${tx.type}|${tx.date}|${Math.abs(Number(tx.amount) || 0).toFixed(2)}|${(tx.description || '').trim().toLowerCase()}`;
};

// --- Tombstones -----------------------------------------------------------
const readTombstones = (userId: string): { ids: Set<string>; signatures: Set<string> } => {
  const ids = new Set<string>();
  const signatures = new Set<string>();
  if (typeof window === 'undefined') return { ids, signatures };
  try {
    const raw = window.localStorage.getItem(getCashTransactionTombstoneKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      parsed.forEach((entry: any) => {
        if (typeof entry === 'string') {
          // Legacy/plain entries are ids
          if (entry.startsWith('sig:')) signatures.add(entry.slice(4));
          else ids.add(entry);
        } else {
          if (entry?.id) ids.add(String(entry.id));
          if (entry?.signature) signatures.add(String(entry.signature));
        }
      });
    }
  } catch { /* corrupted — start fresh */ }
  return { ids, signatures };
};

const writeTombstone = (userId: string, transaction: CashTransaction) => {
  if (typeof window === 'undefined') return;
  try {
    const { ids, signatures } = readTombstones(userId);
    if (transaction.id && !transaction.id.startsWith('local-')) ids.add(transaction.id);
    signatures.add(cashTransactionSignature(transaction));
    // Cap to avoid unbounded growth; oldest entries fall off.
    const idList = Array.from(ids).slice(-400);
    const sigList = Array.from(signatures).slice(-400);
    window.localStorage.setItem(
      getCashTransactionTombstoneKey(userId),
      JSON.stringify({ ids: idList, sigs: sigList })
    );
  } catch { /* storage full/blocked — non-fatal */ }
};

/** Remove a tombstone once the server confirms the row is truly gone. */
const pruneTombstone = (userId: string, transactionId: string, signature?: string) => {
  if (typeof window === 'undefined') return;
  try {
    const { ids, signatures } = readTombstones(userId);
    ids.delete(transactionId);
    if (signature) signatures.delete(signature);
    window.localStorage.setItem(
      getCashTransactionTombstoneKey(userId),
      JSON.stringify({ ids: Array.from(ids).slice(-400), sigs: Array.from(signatures).slice(-400) })
    );
  } catch { /* non-fatal */ }
};

/**
 * Clears any tombstone matching a transaction's signature so a legitimate
 * RE-ADD of identical content is never swallowed by deletion history.
 */
const pruneTombstoneBySignature = (userId: string, transaction: CashTransaction) => {
  const { signatures } = readTombstones(userId);
  const sig = cashTransactionSignature(transaction);
  if (!signatures.has(sig)) return;
  pruneTombstone(userId, '', sig);
};

// Tombstones created before the server confirmed deletion get pruned lazily:
// every successful fetch re-checks and drops stale ones.
const applyTombstoneFilter = (userId: string, transactions: CashTransaction[]): CashTransaction[] => {
  const { ids, signatures } = readTombstones(userId);
  if (ids.size === 0 && signatures.size === 0) return transactions;

  const remainingIds = new Set(ids);
  const remainingSigs = new Set(signatures);
  const filtered = transactions.filter(tx => {
    const sig = cashTransactionSignature(tx);
    const isTombstoned = ids.has(tx.id) || signatures.has(sig);
    if (!isTombstoned) {
      // Server no longer returns this row → deletion was confirmed → forget it.
      remainingIds.delete(tx.id);
      remainingSigs.delete(sig);
    }
    return !isTombstoned;
  });

  try {
    window.localStorage.setItem(
      getCashTransactionTombstoneKey(userId),
      JSON.stringify({ ids: Array.from(remainingIds).slice(-400), sigs: Array.from(remainingSigs).slice(-400) })
    );
  } catch { /* non-fatal */ }

  return filtered;
};

// --- Unsynced queue (survives reloads when the backend write failed) -------
const readUnsynced = (userId: string): CashTransaction[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getCashTransactionUnsyncedKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((t: any) => t?.id && t?.type && t?.date) : [];
  } catch { return []; }
};

const writeUnsynced = (userId: string, transactions: CashTransaction[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getCashTransactionUnsyncedKey(userId), JSON.stringify(transactions.slice(-500)));
  } catch { /* non-fatal */ }
};

const markUnsynced = (userId: string, transaction: CashTransaction) => {
  const next = readUnsynced(userId).filter(t => t.id !== transaction.id);
  next.unshift(transaction);
  writeUnsynced(userId, next);
};

const clearUnsynced = (userId: string, transactionId: string) => {
  writeUnsynced(userId, readUnsynced(userId).filter(t => t.id !== transactionId));
};

/**
 * Merges locally-queued unsynced transactions into a fetched list:
 *  - queued rows with an id the server also returns REPLACE the stale copy
 *    (offline edits win until they sync),
 *  - rows whose content already exists are dropped,
 *  - everything else is prepended so offline adds stay visible.
 */
const mergeUnsynced = (userId: string, serverList: CashTransaction[]): CashTransaction[] => {
  const queued = readUnsynced(userId);
  if (queued.length === 0) return serverList;

  const knownSigs = new Set(serverList.map(cashTransactionSignature));
  const result = [...serverList];
  const prepend: CashTransaction[] = [];

  queued.forEach(tx => {
    const idx = result.findIndex(t => t.id === tx.id);
    if (idx >= 0) {
      result[idx] = tx; // offline edit overrides stale server copy
      return;
    }
    const sig = cashTransactionSignature(tx);
    if (knownSigs.has(sig)) return;
    knownSigs.add(sig);
    prepend.push(tx);
  });

  return prepend.length === 0 ? result : [...prepend, ...result];
};

/**
 * Pushes locally-queued (unsynced) transactions to the backend. Called after a
 * successful fetch proves the backend is reachable again.
 */
const flushUnsyncedCashTransactions = async (userId: string): Promise<void> => {
  const queued = readUnsynced(userId);
  if (queued.length === 0) return;

  const stillUnsynced: CashTransaction[] = [];
  for (const tx of queued) {
    try {
      const { error } = await supabase
        .from('cash_transactions')
        .upsert(mapCashTransactionToDB(tx, userId), { onConflict: 'id' });
      if (error) throw error;
    } catch (error: any) {
      if (isMissingCashTransactionsTableError(error)) throw error;
      stillUnsynced.push(tx); // keep for next attempt (e.g. duplicate → drop silently)
    }
  }
  writeUnsynced(userId, stillUnsynced);
};

const readCashTransactionCache = (userId: string): CashTransaction[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(getCashTransactionCacheKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((tx: any) => ({
        id: String(tx.id || crypto.randomUUID()),
        type: tx.type,
        amount: normalizeCashTransactionAmount({
          type: tx.type,
          amount: tx.amount,
        } as CashTransaction),
        date: tx.date,
        description: tx.description || '',
      }))
      .filter((tx: CashTransaction) => !!tx.type && !!tx.date);
  } catch (error) {
    console.warn('Failed to read cash transaction cache:', error);
    return [];
  }
};

const writeCashTransactionCache = (userId: string, transactions: CashTransaction[]) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getCashTransactionCacheKey(userId), JSON.stringify(transactions));
  } catch (error) {
    console.warn('Failed to write cash transaction cache:', error);
  }
};

const upsertCashTransactionCache = (userId: string, transaction: CashTransaction) => {
  const next = readCashTransactionCache(userId).filter(tx => tx.id !== transaction.id);
  next.unshift(transaction);
  writeCashTransactionCache(userId, next);
  return next;
};

const removeCashTransactionFromCache = (userId: string, transactionId: string) => {
  const next = readCashTransactionCache(userId).filter(tx => tx.id !== transactionId);
  writeCashTransactionCache(userId, next);
  return next;
};

const notifyCashTransactionsChanged = (userId: string) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('jfx-cash-transactions-changed', {
    detail: { userId }
  }));
};

const notifyCashTransactionsAvailability = (available: boolean) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('jfx-cash-transactions-availability', {
    detail: { available }
  }));
};

const isMissingCashTransactionsTableError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  // STRICT matching only — a broad "mentions the table name" check used to
  // misclassify RLS violations as a missing table and permanently disable
  // the feature.
  return (
    error?.status === 404 ||
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    message.includes("relation \"public.cash_transactions\" does not exist") ||
    (message.includes('does not exist') && message.includes('cash_transactions')) ||
    message.includes('schema cache')
  );
};

// Helper to map App Cash Transaction to DB Cash Transaction
const mapCashTransactionToDB = (tx: CashTransaction, userId: string): Partial<DBCashTransaction> => ({
  id: tx.id,
  user_id: userId,
  type: tx.type,
  amount: normalizeCashTransactionAmount(tx),
  date: tx.date,
  description: tx.description,
});

// Helper to map DB Goal to App Goal
export const mapGoalFromDB = (dbGoal: DBGoal): Goal => ({
  id: dbGoal.id,
  title: dbGoal.title,
  description: dbGoal.description,
  type: dbGoal.type,
  metric: dbGoal.metric,
  targetValue: Number(dbGoal.target_value || 0),
  startValue: Number(dbGoal.start_value || 0),
  startDate: dbGoal.start_date,
  endDate: dbGoal.end_date,
  status: dbGoal.status,
  createdAt: dbGoal.created_at,
  milestones: dbGoal.milestones || [],
  manualProgress: Number(dbGoal.current_value || 0),
  autoTrackRule: dbGoal.auto_track_rule,
  manualEntries: dbGoal.manual_entries || []
});

const sourceToBlob = async (source: string): Promise<Blob | null> => {
  if (source.startsWith('data:')) {
    try {
      const commaIndex = source.indexOf(',');
      if (commaIndex === -1) return null;
      const meta = source.slice(0, commaIndex);
      const mimeMatch = meta.match(/^data:([^;,]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const base64 = source.slice(commaIndex + 1);
      const byteCharacters = atob(base64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      return new Blob([byteNumbers], { type: mimeType });
    } catch (e) {
      console.error('Error decoding base64 data URL:', e);
      return null;
    }
  }

  try {
    const response = await fetch(source);
    return await response.blob();
  } catch (e) {
    console.error('Error fetching source blob:', e);
    return null;
  }
};

const uploadImage = async (userId: string, imageSource: string | undefined, type: 'before' | 'after'): Promise<string | undefined> => {
  if (!imageSource) return undefined;
  if (imageSource.startsWith('http')) return imageSource;

  try {
    const blob = await sourceToBlob(imageSource);
    if (!blob || blob.size === 0) return undefined;

    if (blob.size > 1024 * 1024) {
      console.warn(`Image ${type} is too large (${(blob.size / 1024).toFixed(1)}KB). Consider compressing.`);
    }

    const fileExt = 'png';
    const fileName = `${userId}/${Date.now()}-${type}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('trade-images')
      .upload(fileName, blob, {
        contentType: blob.type || 'image/png',
        upsert: true
      });

    if (error) {
      if (error.message === 'The resource was not found') {
        throw new Error('Storage bucket "trade-images" not found. Please create it in Supabase.');
      }
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('trade-images')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (err) {
    console.error(`Error uploading ${type} screenshot:`, err);
    if (imageSource.length < 150000) {
      return imageSource;
    }
    return undefined;
  }
};

export const uploadNoteImage = async (file: File): Promise<string | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    const currentPlan = profile?.plan || APP_CONSTANTS.PLANS.FREE;
    if (!PLAN_FEATURES[currentPlan]?.allowImageUploads) {
      throw new Error('Image uploads are not available on your current plan. Please upgrade.');
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `notes/${user.id}/${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('trade-images')
      .upload(fileName, file, {
        contentType: file.type,
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('trade-images')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (err) {
    console.error('Error uploading note image:', err);
    return null;
  }
};

const deleteImageFile = async (imageUrl: string | undefined) => {
  if (!imageUrl || !imageUrl.includes('trade-images')) return;

  try {
    const pathParts = imageUrl.split('trade-images/');
    if (pathParts.length < 2) return;

    const filePath = pathParts[1];

    const { error } = await supabase.storage
      .from('trade-images')
      .remove([filePath]);

    if (error) throw error;
  } catch (err) {
    console.error('Error deleting image file:', err);
  }
};

const uploadVoiceNote = async (userId: string, voiceSource: string | undefined): Promise<string | undefined> => {
  if (!voiceSource) return undefined;
  if (voiceSource.startsWith('http')) return voiceSource;
  if (!voiceSource.startsWith('data:audio') && !voiceSource.startsWith('blob:')) {
    return voiceSource;
  }

  try {
    const blob = await sourceToBlob(voiceSource);
    if (!blob || blob.size === 0) return undefined;

    let fileExt = 'webm';
    if (blob.type.includes('mp4') || blob.type.includes('m4a')) fileExt = 'm4a';
    else if (blob.type.includes('ogg')) fileExt = 'ogg';
    else if (blob.type.includes('wav')) fileExt = 'wav';
    else if (blob.type.includes('mp3') || blob.type.includes('mpeg')) fileExt = 'mp3';

    const fileName = `${userId}/${Date.now()}-voice.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('trade-images')
      .upload(fileName, blob, {
        contentType: blob.type || 'audio/webm',
        upsert: true
      });

    if (error) {
      if (error.message === 'The resource was not found') {
        console.warn('Storage bucket "trade-images" not found.');
      }
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('trade-images')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (err) {
    console.error('Error uploading voice note:', err);
    if (voiceSource.length < 500000) {
      return voiceSource;
    }
    return undefined;
  }
};

const deleteVoiceNoteFile = async (voiceUrl: string | undefined) => {
  if (!voiceUrl || !voiceUrl.includes('trade-images')) return;

  try {
    const pathParts = voiceUrl.split('trade-images/');
    if (pathParts.length < 2) return;

    const filePath = pathParts[1];

    const { error } = await supabase.storage
      .from('trade-images')
      .remove([filePath]);

    if (error) throw error;
  } catch (err) {
    console.error('Error deleting voice note file:', err);
  }
};

const findExistingTrade = async (userId: string, dbTrade: Partial<DBTrade>): Promise<DBTrade | null> => {
  let query = supabase.from('trades').select('*').eq('user_id', userId).is('deleted_at', null);
  if (dbTrade.ticket_id) {
    query = query.eq('ticket_id', dbTrade.ticket_id);
  } else if (dbTrade.id) {
    query = query.eq('id', dbTrade.id);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as DBTrade | null;
};

const cleanupNewTradeMedia = async (current: Partial<DBTrade> | undefined, urls: Array<string | undefined>) => {
  const previous = new Set([
    current?.before_screenshot,
    current?.after_screenshot,
    current?.voice_note,
  ].filter((url): url is string => Boolean(url)));
  await Promise.allSettled(urls
    .filter((url): url is string => Boolean(url && url.includes('trade-images') && !previous.has(url)))
    .map((url) => deleteImageFile(url)));
};

export const dataService = {
  // Persist portfolio-scoped trading locks. Graceful no-op when the
  // portfolio_locks table hasn't been created yet (migration not applied).
  async savePortfolioLocks(portfolioId: string, locks: unknown) {
    try {
      if (!portfolioId || portfolioId === 'default') return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('portfolio_locks').upsert(
        { user_id: user.id, portfolio_id: portfolioId, locks: locks ?? {}, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,portfolio_id' }
      );
      if (error) console.warn('savePortfolioLocks skipped:', error.message || error.code);
    } catch (err) {
      console.warn('savePortfolioLocks skipped:', (err as Error)?.message);
    }
  },
  // --- Audit Logs ---
  async logActivity(action: string, details: Record<string, any>) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('audit_logs').insert({
        user_id: user.id,
        action,
        details,
        ip_address: 'client-side',
        user_agent: navigator.userAgent
      });
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  },

  // --- Trades ---
  async getTrades(userId: string) {
    // Schema-drift armor: the live table may lack columns this client
    // selects (migrations not yet applied). Strip each missing column the
    // server names and retry — History can never go empty over schema drift.
    // Missing fields read back as undefined and normalizeTrade defaults
    // cover them, so older schemas simply show less detail.
    let columns = TRADE_LIST_COLUMNS_WITH_DISCIPLINE;
    let data: any = null;
    let error: any = null;
    // Cap is generous on purpose: one request per missing column, worst case.
    for (let attempt = 0; attempt < 50; attempt++) {
      const res = await supabase
        .from('trades')
        .select(columns)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('date', { ascending: false });
      data = res.data;
      error = res.error;
      if (!error) break;
      const missing = extractMissingColumnName(error);
      const list = columns.split(',');
      if (!missing || !list.includes(missing)) break;
      console.warn(`getTrades: column ${missing} missing, retrying without it`);
      columns = list.filter((c) => c !== missing).join(',');
    }

    // Bulletproof reads: if the select fails on the portfolio_id column
    // (stale PostgREST schema cache, RLS/select regression), retry without
    // it. The overlay covers assignments, so History can never go fully
    // empty because of one column. The fallback + original error are
    // recorded for the Diagnostics panel.
    if (error) {
      const msg = String((error as any)?.message || (error as any)?.details || (error as any)?.hint || '');
      const looksColumnish = /portfolio_id|column|schema cache|PGRST2/i.test(msg);
      setLastTradesLoadError(`${(error as any)?.code || 'ERR'}: ${msg}`.slice(0, 300));
      if (looksColumnish) {
        console.warn('getTrades full-column select failed, retrying without portfolio_id:', msg);
        const fallback = await supabase
          .from('trades')
          .select(TRADE_LIST_COLUMNS_WITHOUT_PORTFOLIO)
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('date', { ascending: false });
        if (!fallback.error) {
          setLastTradesLoadError(`fallback-ok (full select failed: ${msg})`.slice(0, 300));
          data = fallback.data;
          error = null;
        } else {
          setLastTradesLoadError(`${(fallback.error as any)?.code || 'ERR'}: ${String((fallback.error as any)?.message || '')}`.slice(0, 300));
          throw fallback.error;
        }
      } else {
        throw error;
      }
    } else {
      setLastTradesLoadError(null);
    }
    const overlay = readTradePortfolioOverlay(userId);
    // Rows are typed loosely because the column list is a runtime string;
    // mapTradeFromDB validates/coerces every field it reads.
    // Server portfolio_id wins; overlay covers rows written before migration.
    const out = (data || []).map((row: any) => {
      const mapped = mapTradeFromDB(row);
      const pid = (row as DBTrade).portfolio_id || overlay[(row as DBTrade).id] || undefined;
      if (pid) (mapped as Trade).portfolio_id = pid;
      return mapped;
    });
    // Fire-and-forget: persist overlay for server-assigned rows so a future
    // offline cold start still resolves them when Supabase is unreachable.
    try {
      const fresh = out.filter(t => (t as Trade).portfolio_id && !overlay[t.id]);
      if (fresh.length > 0) {
        const entries: Record<string, string> = {};
        for (const t of fresh) entries[t.id] = (t as Trade).portfolio_id as string;
        writeTradePortfolioOverlays(userId, entries);
      }
    } catch { /* non-fatal */ }
    return out;
  },

  async getTradeChartCandles(tradeId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('trades')
      .select('chart_candles,chart_timeframe')
      .eq('id', tradeId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      // Schema drift: chart columns may not exist yet — the chart tab shows
      // its empty state instead of breaking the whole trade view.
      if (extractMissingColumnName(error)) return null;
      throw error;
    }
    return data && Array.isArray(data.chart_candles)
      ? { candles: data.chart_candles as Trade['chartCandles'], timeframe: data.chart_timeframe || undefined }
      : null;
  },

  async getMonthlyTradeCount(userId: string, year: number, month: number) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    const { count, error } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;
    return count || 0;
  },

  async addTrade(trade: Trade) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const normalizedInput = normalizeTrade(trade, {}, { preserveProvidedPnl: trade.ticketId !== undefined });

    const [beforeUrl, afterUrl, voiceUrl] = await Promise.all([
      uploadImage(user.id, normalizedInput.beforeScreenshot, 'before'),
      uploadImage(user.id, normalizedInput.afterScreenshot, 'after'),
      uploadVoiceNote(user.id, normalizedInput.voiceNote),
    ]);

    const tradeToSave = {
      ...normalizedInput,
      beforeScreenshot: beforeUrl,
      afterScreenshot: afterUrl,
      voiceNote: voiceUrl,
    };

    const dbTrade = buildTradeDbPayload(tradeToSave, user.id);

    const existingTrade = await findExistingTrade(user.id, dbTrade);
    if (existingTrade) {
      console.warn(`Trade ${dbTrade.ticket_id || dbTrade.id} already exists. Skipping.`);
      await cleanupNewTradeMedia(existingTrade, [beforeUrl, afterUrl, voiceUrl]);
      return mapTradeFromDB(existingTrade);
    }

    const performInsert = async (data: Partial<DBTrade>): Promise<DBTrade> => {
      const { data: insertedRow, error } = await supabase
        .from('trades')
        .insert(data)
        .select()
        .single();

      if (error) {
        if (isUniqueViolation(error)) {
          const existing = await findExistingTrade(user.id, data);
          if (existing) return existing;
        }
        const missingField = extractMissingColumnName(error) as keyof DBTrade | null;
        if (missingField && missingField in data) {
          console.warn(`Column ${missingField} missing in trades table. Retrying insert without it.`);
          const { [missingField]: _, ...safeData } = data;
          return performInsert(safeData);
        }
        throw error;
      }
      return insertedRow as DBTrade;
    };

    try {
      const data = await performInsert(dbTrade);
      return mapTradeFromDB(data);
    } catch (error) {
      await cleanupNewTradeMedia(undefined, [beforeUrl, afterUrl, voiceUrl]);
      throw error;
    }
  },

  async batchAddTrades(trades: Trade[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const normalizedTrades = trades.map(trade =>
      normalizeTrade(trade, {}, { preserveProvidedPnl: trade.ticketId !== undefined })
    );

    const ticketIds = normalizedTrades.map(t => t.ticketId).filter(Boolean) as string[];
    
    let existingTicketIds = new Set<string>();
    if (ticketIds.length > 0) {
      const { data: existing } = await supabase
        .from('trades')
        .select('ticket_id')
        .eq('user_id', user.id)
        .in('ticket_id', ticketIds)
        .is('deleted_at', null);
      
      existingTicketIds = new Set(existing?.map(t => t.ticket_id) || []);
    }

    const tradesToSave = normalizedTrades
      .filter(t => !t.ticketId || !existingTicketIds.has(t.ticketId))
      .map(t => buildTradeDbPayload(t, user.id));

    if (tradesToSave.length === 0) return [];

    const insertOne = async (record: Partial<DBTrade>): Promise<DBTrade | null> => {
      const { data, error } = await supabase
        .from('trades')
        .insert(record)
        .select()
        .single();
      if (!error) return data as DBTrade;

      if (isUniqueViolation(error)) {
        return findExistingTrade(user.id, record);
      }
      const missingField = extractMissingColumnName(error) as keyof DBTrade | null;
      if (missingField && missingField in record) {
        const { [missingField]: _, ...safeRecord } = record;
        return insertOne(safeRecord);
      }
      throw error;
    };

    // Small concurrent batches preserve import speed without firing thousands
    // of writes at once or letting one duplicate abort the whole import.
    const saved: DBTrade[] = [];
    for (let index = 0; index < tradesToSave.length; index += 20) {
      const rows = await Promise.all(tradesToSave.slice(index, index + 20).map(insertOne));
      saved.push(...rows.filter((row): row is DBTrade => row !== null));
    }
    return saved.map(mapTradeFromDB);
  },

  async updateTrade(trade: Trade): Promise<Trade> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Light pre-read: only columns the guard/freeze/cleanup need. Retries
    // without voice_note on schema drift so the guard keeps working.
    const preread = async (columns: string) => supabase
      .from('trades')
      .select(columns)
      .eq('id', trade.id)
      .eq('user_id', user.id)
      .single();
    let currentTradeRow: any = null;
    {
      const first = await preread('id,updated_at,ticket_id,tags,date,time,entry_price,exit_price,result,before_screenshot,after_screenshot,voice_note');
      if (first.error && extractMissingColumnName(first.error)) {
        console.warn('updateTrade pre-read: column missing, retrying without voice_note');
        const second = await preread('id,updated_at,ticket_id,tags,date,time,entry_price,exit_price,result,before_screenshot,after_screenshot');
        currentTradeRow = second.data;
      } else {
        currentTradeRow = first.data;
      }
    }

    if (trade.updatedAt && currentTradeRow?.updated_at && trade.updatedAt !== currentTradeRow.updated_at) {
      throw new Error('This trade was updated in another tab. Reload it before saving your changes.');
    }

    const currentTrade = currentTradeRow ? mapTradeFromDB(currentTradeRow as DBTrade) : undefined;
    const isBridgeManagedTrade = Boolean(
      currentTrade?.ticketId ||
      currentTrade?.tags?.some(tag => /MT[45]_Auto_Journal|Imported/i.test(tag))
    );
    const hasOwnProperty = (key: keyof Pick<Trade, 'beforeScreenshot' | 'afterScreenshot' | 'voiceNote'>) =>
      Object.prototype.hasOwnProperty.call(trade, key);
    const beforeScreenshotCleared = hasOwnProperty('beforeScreenshot') && !trade.beforeScreenshot;
    const afterScreenshotCleared = hasOwnProperty('afterScreenshot') && !trade.afterScreenshot;
    const voiceNoteCleared = hasOwnProperty('voiceNote') && !trade.voiceNote;

    const tradeForSave = isBridgeManagedTrade && currentTrade
      ? {
          ...trade,
          date: currentTrade.date,
          time: currentTrade.time,
          entryPrice: currentTrade.entryPrice,
          exitPrice: currentTrade.exitPrice,
          result: currentTrade.result,
        }
      : trade;

    const normalizedInput = normalizeTrade(
      tradeForSave,
      currentTrade,
      { preserveProvidedPnl: true }
    );

    // Upload first. The old object remains reachable until the database row
    // points at the replacement, so a failed update cannot leave a broken UI.
    const [beforeUrl, afterUrl, voiceUrl] = await Promise.all([
      uploadImage(user.id, normalizedInput.beforeScreenshot, 'before'),
      uploadImage(user.id, normalizedInput.afterScreenshot, 'after'),
      uploadVoiceNote(user.id, normalizedInput.voiceNote),
    ]);

    const tradeToUpdate = {
      ...normalizedInput,
      beforeScreenshot: beforeUrl,
      afterScreenshot: afterUrl,
      voiceNote: voiceUrl,
    };

    let updateData = buildTradeDbPayload(tradeToUpdate, user.id, currentTrade || trade);
    if (beforeScreenshotCleared) {
      (updateData as any).before_screenshot = null;
    }
    if (afterScreenshotCleared) {
      (updateData as any).after_screenshot = null;
    }
    if (voiceNoteCleared) {
      (updateData as any).voice_note = null;
    }
    
    const performUpdate = async (data: Partial<DBTrade>): Promise<DBTrade> => {
      let query = supabase
        .from('trades')
        .update(data)
        .eq('id', trade.id)
        .eq('user_id', user.id);
      if (currentTradeRow?.updated_at) query = query.eq('updated_at', currentTradeRow.updated_at);
      const { data: updatedRow, error } = await query.select('*').single();
      
      if (error) {
        const missingField = extractMissingColumnName(error) as keyof DBTrade | null;
        if (missingField && missingField in data) {
          console.warn(`Column ${missingField} missing. Retrying without it.`);
          const { [missingField]: _, ...safeData } = data;
          return performUpdate(safeData);
        }
        throw error;
      }
      return updatedRow as DBTrade;
    };

    try {
      const refreshedTrade = await performUpdate(updateData);

      const previousMediaToDelete: Promise<void>[] = [];
      if (currentTradeRow?.before_screenshot && currentTradeRow.before_screenshot !== beforeUrl) {
        previousMediaToDelete.push(deleteImageFile(currentTradeRow.before_screenshot));
      }
      if (currentTradeRow?.after_screenshot && currentTradeRow.after_screenshot !== afterUrl) {
        previousMediaToDelete.push(deleteImageFile(currentTradeRow.after_screenshot));
      }
      if (currentTradeRow?.voice_note && currentTradeRow.voice_note !== voiceUrl) {
        previousMediaToDelete.push(deleteVoiceNoteFile(currentTradeRow.voice_note));
      }
      await Promise.allSettled(previousMediaToDelete);
      return mapTradeFromDB(refreshedTrade);
    } catch (error) {
      // The row was not changed, so remove only newly uploaded replacement
      // files and leave the existing media untouched.
      await cleanupNewTradeMedia(currentTradeRow as Partial<DBTrade> | undefined, [beforeUrl, afterUrl, voiceUrl]);
      throw error;
    }
  },

  async updateTradeComments(tradeId: string, notes: string | undefined, exitComment: string | undefined): Promise<Trade> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('trades')
      .update({ notes: notes || null, exit_comment: exitComment || null })
      .eq('id', tradeId)
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (error) throw error;
    return mapTradeFromDB(data as DBTrade);
  },

  /**
   * Light fast-path for small metadata edits (notes, rating, tags…).
   * Single UPDATE, no pre-read, no media pipeline — ~1 hop vs 3–8.
   */
  async updateTradeFields(tradeId: string, fields: { notes?: string; exitComment?: string; rating?: number; tags?: string[] }): Promise<Trade> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const payload: Record<string, unknown> = {};
    if ('notes' in fields) payload.notes = fields.notes || null;
    if ('exitComment' in fields) payload.exit_comment = fields.exitComment || null;
    if ('rating' in fields) payload.rating = Number.isFinite(Number(fields.rating)) ? Number(fields.rating) : 0;
    if ('tags' in fields) payload.tags = Array.isArray(fields.tags) ? fields.tags : [];
    if (Object.keys(payload).length === 0) throw new Error('No editable fields provided');

    const performLight = async (data: Record<string, unknown>): Promise<DBTrade> => {
      const { data: row, error } = await supabase
        .from('trades')
        .update(data)
        .eq('id', tradeId)
        .eq('user_id', user.id)
        .select('*')
        .single();
      if (error) {
        const missingField = extractMissingColumnName(error) as keyof DBTrade | null;
        if (missingField && missingField in data) {
          const { [missingField]: _, ...safe } = data;
          return performLight(safe);
        }
        throw error;
      }
      return row as DBTrade;
    };

    return mapTradeFromDB(await performLight(payload));
  },

  async batchUpdateTrades(trades: Trade[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Bounded concurrency: 25 writes per chunk, chunks sequential.
    const BATCH_CHUNK = 25;
    const performBatch = async (dataList: { id: string, data: Partial<DBTrade> }[]): Promise<void> => {
      for (let i = 0; i < dataList.length; i += BATCH_CHUNK) {
        const slice = dataList.slice(i, i + BATCH_CHUNK);
        const promises = slice.map(item =>
          supabase.from('trades').update(item.data).eq('id', item.id).eq('user_id', user.id)
        );

        const results = await Promise.all(promises);
        const failedResult = results.find(r => r.error);

        if (failedResult && failedResult.error) {
          const missingField = extractMissingColumnName(failedResult.error) as keyof DBTrade | null;
          if (missingField) {
            console.warn(`Batch: Column ${missingField} missing. Stripping and retrying.`);
            const nextDataList = dataList.map(item => {
              const { [missingField]: _, ...safeData } = item.data;
              return { id: item.id, data: safeData };
            });
            return performBatch(nextDataList);
          }
          throw failedResult.error;
        }
      }
    };

    const initialDataList = trades.map(t => ({
      id: t.id,
      data: buildTradeDbPayload(
        normalizeTrade(t, {}, { preserveProvidedPnl: t.ticketId !== undefined }),
        user.id
      )
    }));

    await performBatch(initialDataList);
  },

  async deleteTrades(tradeIds: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Chunked: PostgREST URL/param limits break bulk deletes of 100s of ids.
    const CHUNK = 200;
    for (let i = 0; i < tradeIds.length; i += CHUNK) {
      const { error } = await supabase
        .from('trades')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', tradeIds.slice(i, i + CHUNK))
        .eq('user_id', user.id);

      if (error) throw error;
    }
  },

  async restoreTrades(tradeIds: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const CHUNK = 200;
    for (let i = 0; i < tradeIds.length; i += CHUNK) {
      const { error } = await supabase
        .from('trades')
        .update({ deleted_at: null })
        .in('id', tradeIds.slice(i, i + CHUNK))
        .eq('user_id', user.id);

      if (error) throw error;
    }
  },

  async deduplicateManualTrades() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data: manualTrades, error } = await supabase
      .from('trades')
      .select('id, pair, date, time, entry_price, exit_price, direction, lots, pnl')
      .eq('user_id', user.id)
      .is('ticket_id', null)
      .is('deleted_at', null);

    if (error) throw error;
    if (!manualTrades || manualTrades.length === 0) return 0;

    const seen = new Set<string>();
    const duplicateIds: string[] = [];

    manualTrades.forEach(trade => {
      const key = [
        trade.date,
        trade.time || '',
        trade.pair,
        trade.direction,
        trade.entry_price,
        trade.exit_price ?? '',
        trade.lots,
        trade.pnl,
      ].join('|');
      if (seen.has(key)) {
        duplicateIds.push(trade.id);
      } else {
        seen.add(key);
      }
    });

    if (duplicateIds.length > 0) {
      await this.deleteTrades(duplicateIds);
    }

    return duplicateIds.length;
  },

  // --- Notes ---
  async getNotes(userId: string) {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map(mapNoteFromDB);
  },

  async addNote(note: Note) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const imageUrl = await uploadImage(user.id, note.image, 'after');

    const insertData = {
      user_id: user.id,
      title: note.title,
      content: note.content,
      date: note.date,
      tags: note.tags,
      color: note.color,
      is_pinned: !!note.isPinned,
      is_archived: !!note.isArchived,
      is_trashed: !!note.isTrashed,
      is_list: !!note.isList,
      list_items: note.listItems || [],
      image: imageUrl ?? null,
      table_data: note.tableData || null,
      position: note.position || 0
    };

    const performInsert = async (data: any): Promise<any> => {
      const { data: result, error } = await supabase
        .from('notes')
        .insert(data)
        .select()
        .single();

      if (error) {
        console.error("Supabase addNote error:", error);
        const missingField = extractMissingColumnName(error);
        if (missingField && missingField in data) {
          console.warn(`Column ${missingField} missing in notes table. Retrying insert without it.`);
          const { [missingField]: _, ...safeData } = data;
          return performInsert(safeData);
        }
        throw error;
      }
      return result;
    };

    const data = await performInsert(insertData);
    
    return mapNoteFromDB(data);
  },

  async updateNote(note: Partial<Note> & { id: string }): Promise<Note> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const imageProvided = Object.prototype.hasOwnProperty.call(note, 'image');
    const nextImage = imageProvided ? (note.image ? await uploadImage(user.id, note.image, 'after') : null) : undefined;

    const { data: currentNote } = await supabase
      .from('notes')
      .select('image')
      .eq('id', note.id)
      .eq('user_id', user.id)
      .single();

    const updateData: any = {};
    if (note.title !== undefined) updateData.title = note.title;
    if (note.content !== undefined) updateData.content = note.content;
    if (note.tags !== undefined) updateData.tags = note.tags;
    if (note.color !== undefined) updateData.color = note.color;
    if (note.isPinned !== undefined) updateData.is_pinned = !!note.isPinned;
    if (note.isArchived !== undefined) updateData.is_archived = !!note.isArchived;
    if (note.isTrashed !== undefined) updateData.is_trashed = !!note.isTrashed;
    if (note.isList !== undefined) updateData.is_list = !!note.isList;
    if (note.listItems !== undefined) updateData.list_items = note.listItems || [];
    if (imageProvided) {
      updateData.image = nextImage;
    }
    if (note.tableData !== undefined) updateData.table_data = note.tableData;
    if (note.date !== undefined) updateData.date = note.date;
    if (note.position !== undefined) updateData.position = note.position;

    const performUpdate = async (data: any): Promise<any> => {
      let query = supabase
        .from('notes')
        .update(data)
        .eq('id', note.id)
        .eq('user_id', user.id);
      if (note.updatedAt) query = query.eq('updated_at', note.updatedAt);
      const { error, data: updatedRows } = await query.select('*');

      if (error) {
        console.error("Supabase updateNote error:", error);
        if (error.code === '42703' || error.code === 'PGRST204' || ((error as any).status === 400 && error.message.includes('column'))) {
          const fieldMatch = error.message.match(/column "(.+)"/i) || 
                             error.message.match(/column (.+) of/i) || 
                             error.message.match(/'(.+)' column/i);
          if (fieldMatch && (fieldMatch[1] || fieldMatch[2] || fieldMatch[3])) {
            const missingField = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]).replace(/"/g, '').replace(/'/g, '') as string;
            console.warn(`Column ${missingField} missing in notes table. Retrying update without it.`);
            const { [missingField]: _, ...safeData } = data;
            return performUpdate(safeData);
          }
        }
        throw error;
      }
      if (note.updatedAt && (!updatedRows || updatedRows.length === 0)) {
        throw new Error('This note was updated in another tab. Reload it before saving your changes.');
      }
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('Note no longer exists or you no longer have access to it.');
      }
      return updatedRows[0];
    };

    let savedNote: any;
    try {
      savedNote = await performUpdate(updateData);
    } catch (error) {
      if (imageProvided && nextImage && nextImage !== currentNote?.image) {
        await deleteImageFile(nextImage);
      }
      throw error;
    }

    if (imageProvided && currentNote?.image && currentNote.image !== nextImage) {
      await deleteImageFile(currentNote.image);
    }
    return mapNoteFromDB(savedNote);
  },

  /**
   * Reorder-only write. `updateNote` re-reads the row (image etc.) on every
   * call, which made dragging a page of notes fire hundreds of round trips —
   * this issues one bare UPDATE per row, in bounded parallel chunks.
   */
  async updateNotePositions(
    positions: { id: string; position: number }[]
  ): Promise<{ id: string; updated_at: string }[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    if (!positions.length) return [];

    const saved: { id: string; updated_at: string }[] = [];
    const CHUNK = 25;
    for (let i = 0; i < positions.length; i += CHUNK) {
      const slice = positions.slice(i, i + CHUNK);
      const results = await Promise.all(
        slice.map(item =>
          supabase
            .from('notes')
            .update({ position: item.position })
            .eq('id', item.id)
            .eq('user_id', user.id)
            .select('id, updated_at')
        )
      );
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
      results.forEach(r => {
        if (Array.isArray(r.data)) saved.push(...(r.data as { id: string; updated_at: string }[]));
      });
    }
    // `updated_at` moves with every write; callers need the new revisions or the
    // next optimistic-concurrency check would reject the note as "changed elsewhere".
    return saved;
  },

  async deleteNote(noteId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', user.id);

    if (error) throw error;
  },

  // --- Daily Bias ---
  async getDailyBias(userId: string) {
    const { data, error } = await supabase
      .from('daily_bias')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data.map((bias: any) => ({
      ...bias,
      actualOutcome: bias.actual_outcome
    }));
  },

  async updateBias(bias: DailyBias) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('daily_bias')
      .upsert({
        user_id: user.id,
        date: bias.date,
        bias: bias.bias,
        notes: bias.notes,
        actual_outcome: bias.actualOutcome
      }, { onConflict: 'user_id,date' });

    if (error) throw error;
  },

  // --- Goals ---
  async getGoals(userId: string) {
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapGoalFromDB);
  },

  async addGoal(goal: Goal) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data: existing } = await supabase
      .from('goals')
      .select('id')
      .eq('user_id', user.id)
      .eq('title', goal.title)
      .eq('type', goal.type)
      .eq('target_value', goal.targetValue)
      .maybeSingle();

    if (existing) {
      console.warn("Potential duplicate goal detected. Returning existing.");
      const { data } = await supabase.from('goals').select('*').eq('id', existing.id).single();
      return mapGoalFromDB(data);
    }

    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id: user.id,
        title: goal.title,
        description: goal.description,
        type: goal.type,
        metric: goal.metric,
        target_value: goal.targetValue,
        start_value: goal.startValue,
        current_value: goal.manualProgress || 0,
        start_date: goal.startDate,
        end_date: goal.endDate,
        status: goal.status,
        milestones: goal.milestones,
        auto_track_rule: goal.autoTrackRule,
        manual_entries: goal.manualEntries
      })
      .select()
      .single();

    if (error) throw error;
    return mapGoalFromDB(data);
  },

  async updateGoal(goal: Goal) {
    const { error } = await supabase
      .from('goals')
      .update({
        title: goal.title,
        description: goal.description,
        type: goal.type,
        metric: goal.metric,
        target_value: goal.targetValue,
        start_value: goal.startValue,
        current_value: goal.manualProgress,
        start_date: goal.startDate,
        end_date: goal.endDate,
        status: goal.status,
        milestones: goal.milestones,
        auto_track_rule: goal.autoTrackRule,
        manual_entries: goal.manualEntries
      })
      .eq('id', goal.id);

    if (error) throw error;
  },

  async deleteGoal(goalId: string) {
    const { error } = await supabase
      .from('goals')
      .delete()
      .eq('id', goalId);

    if (error) throw error;
  },

  // --- Profile ---
  async updateProfile(profile: Partial<UserProfile>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const dbProfile: Record<string, any> = {};
    if (profile.name !== undefined) dbProfile.name = profile.name;
    if (profile.country !== undefined) dbProfile.country = profile.country;
    if (profile.accountName !== undefined) dbProfile.account_name = profile.accountName;
    if (profile.initialBalance !== undefined) dbProfile.initial_balance = Number(profile.initialBalance);
    if (profile.currency !== undefined) dbProfile.currency = profile.currency;
    if (profile.currencySymbol !== undefined) dbProfile.currency_symbol = profile.currencySymbol;
    if (profile.syncMethod !== undefined) dbProfile.sync_method = profile.syncMethod;
    if (profile.experienceLevel !== undefined) dbProfile.experience_level = profile.experienceLevel;
    if (profile.tradingStyle !== undefined) dbProfile.trading_style = profile.tradingStyle;
    if (profile.onboarded !== undefined) dbProfile.onboarded = profile.onboarded;
    if (profile.plan !== undefined) dbProfile.plan = normalizePlan(profile.plan);
    if (profile.syncKey !== undefined) dbProfile.sync_key = profile.syncKey;
    if (profile.eaConnected !== undefined) dbProfile.ea_connected = profile.eaConnected;
    if (profile.autoJournal !== undefined) dbProfile.auto_journal = profile.autoJournal;
    if (profile.avatarUrl !== undefined) dbProfile.avatar_url = profile.avatarUrl;
    if (profile.themePreference !== undefined) dbProfile.theme_preference = profile.themePreference;
    if (profile.chartConfig !== undefined) dbProfile.chart_config = profile.chartConfig;
    if (profile.keepChartsAlive !== undefined) dbProfile.keep_charts_alive = profile.keepChartsAlive;
    if (profile.timezone !== undefined) dbProfile.timezone = profile.timezone;

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        ...dbProfile,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error updating profile:', error);
      if (error.code === '42703' || error.code === 'PGRST204' || ((error as any).status === 400 && error.message.includes('column'))) {
        const fieldMatch = error.message.match(/column "(.+)"/i) || 
                           error.message.match(/column (.+) of/i) || 
                           error.message.match(/'(.+)' column/i);
        if (fieldMatch && (fieldMatch[1] || fieldMatch[2] || fieldMatch[3])) {
          const missingField = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]).replace(/"/g, '').replace(/'/g, '');
          console.warn(`Column ${missingField} missing in profiles table. Retrying without it.`);
          const { [missingField]: _, ...safeProfile } = dbProfile;
          const { error: retryError } = await supabase
            .from('profiles')
            .upsert({ id: user.id, ...safeProfile });
          if (retryError) throw retryError;
          return;
        }
      }
      throw error;
    }
  },

  // --- EA Session ---
  async getEASession(syncKey: string) {
    const { data, error } = await supabase
      .from('ea_sessions')
      .select('*')
      .eq('sync_key', syncKey)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  // --- Strategy Diagrams ---
  async getDiagrams(userId: string) {
    const { data, error } = await supabase
      .from('strategy_diagrams')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      category: d.category,
      description: d.description,
      createdAt: d.created_at,
      updatedAt: d.updated_at
    }));
  },

  async saveDiagram(diagram: Partial<StrategyDiagram>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const dbDiagram = {
      user_id: user.id,
      name: diagram.name,
      code: diagram.code,
      category: diagram.category,
      description: diagram.description,
      updated_at: new Date().toISOString()
    };

    if (diagram.id) {
      const { data, error } = await supabase
        .from('strategy_diagrams')
        .update(dbDiagram)
        .eq('id', diagram.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('strategy_diagrams')
        .insert(dbDiagram)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  async deleteDiagram(id: string) {
    const { error } = await supabase
      .from('strategy_diagrams')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // --- Backtest Sessions ---
  async saveBacktestSession(session: Omit<BacktestSession, 'id' | 'user_id' | 'updated_at'>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const basePayload = {
      user_id: user.id,
      symbol: session.symbol,
      timeframe: session.timeframe,
      data: session.data,
      drawings: session.drawings,
      trades: session.trades,
      updated_at: new Date().toISOString()
    };

    const { data: existingSession, error: findError } = await supabase
      .from('backtest_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('symbol', session.symbol)
      .eq('timeframe', session.timeframe)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (existingSession?.id) {
      const { data, error } = await supabase
        .from('backtest_sessions')
        .update(basePayload)
        .eq('id', existingSession.id)
        .select()
        .single();

      if (error) throw error;
      return data as BacktestSession;
    }

    const { data, error } = await supabase
      .from('backtest_sessions')
      .insert(basePayload)
      .select()
      .single();

    if (error) throw error;
    return data as BacktestSession;
  },

  async getBacktestSessions(): Promise<BacktestSession[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('backtest_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data || []) as BacktestSession[];
  },

  async deleteBacktestSession(id: string) {
    const { error } = await supabase
      .from('backtest_sessions')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  // --- Cash Transactions -----------------------------------------------------
  // Design guarantees:
  //  1. A transaction the user deletes can never reappear (tombstones).
  //  2. A transaction the user adds is never silently lost — if the backend
  //     write fails it lands in an unsynced queue that survives reloads and
  //     auto-flushes once the backend is reachable again.
  //  3. Backend outages degrade gracefully and RECOVER automatically.
  async getCashTransactions(userId: string) {
    if (!cashBackendAvailable()) {
      return applyTombstoneFilter(userId, mergeUnsynced(userId, readCashTransactionCache(userId)));
    }

    const { data, error } = await supabase
      .from('cash_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) {
      if (isMissingCashTransactionsTableError(error)) {
        cashTransactionsBackendUnavailableAt = Date.now();
        notifyCashTransactionsAvailability(false);
        return applyTombstoneFilter(userId, mergeUnsynced(userId, readCashTransactionCache(userId)));
      }
      // Transient failure (network/RLS/etc.): serve cache + unsynced without
      // tripping the kill-switch, so a flaky request can't blank the feature.
      console.warn('getCashTransactions failed; serving local data:', error?.message || error);
      return applyTombstoneFilter(userId, mergeUnsynced(userId, readCashTransactionCache(userId)));
    }

    cashTransactionsBackendUnavailableAt = 0;
    notifyCashTransactionsAvailability(true);

    // Opportunistically push anything queued while offline.
    try { await flushUnsyncedCashTransactions(userId); } catch { /* retry later */ }

    const mapped = applyTombstoneFilter(userId, (data || []).map(mapCashTransactionFromDB));
    // Merge in any still-unsynced rows so they stay visible until flushed.
    const mergedList = mergeUnsynced(userId, mapped);
    writeCashTransactionCache(userId, mergedList);
    return mergedList;
  },

  async addCashTransaction(transaction: CashTransaction) {
    let user: any = null;
    try {
      const authResult = await supabase.auth.getUser();
      user = authResult?.data?.user;
    } catch { /* handled below */ }
    if (!user) throw new Error('User not authenticated');

    const saved: CashTransaction = {
      ...transaction,
      id: transaction.id && !transaction.id.startsWith('local-') ? transaction.id : crypto.randomUUID(),
      amount: normalizeCashTransactionAmount(transaction),
    };

    if (!cashBackendAvailable()) {
      upsertCashTransactionCache(user.id, saved);
      markUnsynced(user.id, saved);
      notifyCashTransactionsChanged(user.id);
      return saved;
    }

    try {
      const { data, error } = await supabase
        .from('cash_transactions')
        .upsert(mapCashTransactionToDB(saved, user.id), { onConflict: 'id' })
        .select()
        .single();

      if (error) throw error;

      const mapped = mapCashTransactionFromDB(data);
      clearUnsynced(user.id, saved.id);
      upsertCashTransactionCache(user.id, mapped);
      pruneTombstoneBySignature(user.id, mapped);
      notifyCashTransactionsChanged(user.id);
      return mapped;
    } catch (error) {
      if (isMissingCashTransactionsTableError(error)) {
        cashTransactionsBackendUnavailableAt = Date.now();
        notifyCashTransactionsAvailability(false);
      } else {
        console.warn('addCashTransaction backend write failed; queued locally:', error?.message || error);
      }
      // NEVER lose the row: keep it visible via cache + unsynced queue.
      upsertCashTransactionCache(user.id, saved);
      markUnsynced(user.id, saved);
      notifyCashTransactionsChanged(user.id);
      // Re-throw ONLY as a typed marker the UI understands (row stays visible,
      // marked as pending sync).
      (saved as any).__unsynced = true;
      return saved;
    }
  },

  async updateCashTransaction(transaction: CashTransaction) {
    let user: any = null;
    try {
      const authResult = await supabase.auth.getUser();
      user = authResult?.data?.user;
    } catch { /* handled below */ }
    if (!user) throw new Error('User not authenticated');

    const updated: CashTransaction = { ...transaction, amount: normalizeCashTransactionAmount(transaction) };

    if (cashBackendAvailable()) {
      try {
        const { error } = await supabase
          .from('cash_transactions')
          .update({
            type: updated.type,
            amount: updated.amount,
            date: updated.date,
            description: updated.description,
          })
          .eq('id', updated.id)
          .eq('user_id', user.id);

        if (error) throw error;
        clearUnsynced(user.id, updated.id);
        upsertCashTransactionCache(user.id, updated);
        notifyCashTransactionsChanged(user.id);
        return;
      } catch (error) {
        if (isMissingCashTransactionsTableError(error)) {
          cashTransactionsBackendUnavailableAt = Date.now();
          notifyCashTransactionsAvailability(false);
        } else {
          console.warn('updateCashTransaction backend write failed; kept locally:', error?.message || error);
        }
      }
    }
    upsertCashTransactionCache(user.id, updated);
    markUnsynced(user.id, updated);
    notifyCashTransactionsChanged(user.id);
  },

  async deleteCashTransaction(transactionId: string) {
    let user: any = null;
    try {
      const authResult = await supabase.auth.getUser();
      user = authResult?.data?.user;
    } catch { /* handled below */ }
    if (!user) throw new Error('User not authenticated');

    // Tombstone FIRST so no refetch race can resurrect the row mid-delete.
    const cached = readCashTransactionCache(user.id).find(t => t.id === transactionId);
    if (cached) writeTombstone(user.id, cached);

    removeCashTransactionFromCache(user.id, transactionId);
    clearUnsynced(user.id, transactionId);

    if (transactionId.startsWith('local-')) {
      notifyCashTransactionsChanged(user.id);
      return;
    }

    if (cashBackendAvailable()) {
      try {
        const { error } = await supabase
          .from('cash_transactions')
          .delete()
          .eq('id', transactionId)
          .eq('user_id', user.id);

        if (error) throw error;
        if (cached) pruneTombstone(user.id, transactionId, cashTransactionSignature(cached));
        notifyCashTransactionsChanged(user.id);
        return;
      } catch (error) {
        console.warn('deleteCashTransaction failed; tombstone keeps it hidden:', error?.message || error);
        if (isMissingCashTransactionsTableError(error)) {
          cashTransactionsBackendUnavailableAt = Date.now();
          notifyCashTransactionsAvailability(false);
        }
      }
    }
    // Keep the tombstone — the row stays hidden even though the server delete
    // didn't confirm. It will be pruned once a fetch proves it's gone.
    notifyCashTransactionsChanged(user.id);
  },
};
