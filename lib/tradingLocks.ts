import { getDefaultTimezone } from './timeUtils';

/** Cooling-off period before a requested unlock takes effect. */
export const LOCK_UNLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const LOCKS_KEY = 'jfx_trading_locks_v1';
const STATS_PREFIX = 'jfx_lock_stats_';

export interface PairWhitelistRule {
  enabled: boolean;
  /** Stable cTrader symbolIds (immune to ".0" renames). */
  symbolIds: number[];
  /** Name snapshot per symbolId for display. */
  symbolNames: Record<number, string>;
  unlockRequestedAt: string | null;
}

export interface MaxTradesRule {
  enabled: boolean;
  maxPerDay: number;
  unlockRequestedAt: string | null;
}

export interface LotGuardRule {
  enabled: boolean;
  minLots?: number;
  maxLots?: number;
  unlockRequestedAt: string | null;
}

export interface PortfolioLocks {
  pairWhitelist: PairWhitelistRule;
  maxTrades: MaxTradesRule;
  lotGuard: LotGuardRule;
  updatedAt: string;
}

export type TradingLocksStore = Record<string, PortfolioLocks>;

export interface LockStats {
  blocks: number;
  fills: number;
}

export const blankPortfolioLocks = (): PortfolioLocks => ({
  pairWhitelist: { enabled: false, symbolIds: [], symbolNames: {}, unlockRequestedAt: null },
  maxTrades: { enabled: false, maxPerDay: 2, unlockRequestedAt: null },
  lotGuard: { enabled: false, minLots: undefined, maxLots: undefined, unlockRequestedAt: null },
  updatedAt: new Date().toISOString(),
});

const safeParse = (raw: string | null): TradingLocksStore | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as TradingLocksStore;
    return null;
  } catch {
    return null;
  }
};

const storage = {
  get(key: string): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      /* storage blocked */
    }
  },
};

export const readLocks = (): TradingLocksStore => safeParse(storage.get(LOCKS_KEY)) ?? {};

export const readPortfolioLocks = (portfolioId: string | null | undefined): PortfolioLocks => {
  if (!portfolioId) return blankPortfolioLocks();
  const store = readLocks();
  const found = store[portfolioId];
  if (!found) return blankPortfolioLocks();
  const blank = blankPortfolioLocks();
  const now = Date.now();
  return {
    pairWhitelist: normalizeRule({ ...blank.pairWhitelist, ...(found.pairWhitelist || {}) }, now),
    maxTrades: normalizeRule({ ...blank.maxTrades, ...(found.maxTrades || {}) }, now),
    lotGuard: normalizeRule({ ...blank.lotGuard, ...(found.lotGuard || {}) }, now),
    updatedAt: found.updatedAt || blank.updatedAt,
  };
};

export const writePortfolioLocks = (portfolioId: string, locks: PortfolioLocks): void => {
  if (!portfolioId) return;
  const store = readLocks();
  store[portfolioId] = { ...locks, updatedAt: new Date().toISOString() };
  storage.set(LOCKS_KEY, JSON.stringify(store));
};

/** Milliseconds until a requested unlock takes effect (<=0 = effective now). */
export const unlockMsRemaining = (unlockRequestedAt: string | null | undefined, now = Date.now()): number => {
  if (!unlockRequestedAt) return 0;
  const t = Date.parse(unlockRequestedAt);
  if (!Number.isFinite(t)) return 0;
  return t + LOCK_UNLOCK_COOLDOWN_MS - now;
};

/**
 * A rule binds while enabled — INCLUDING during a cooling countdown.
 * Toggling a rule off starts the 24h countdown but the rule keeps enforcing
 * until the countdown elapses (that's the whole point of the cooling).
 * After expiry the rule is off.
 */
export const isRuleActive = (rule: { enabled: boolean; unlockRequestedAt?: string | null }, now = Date.now()): boolean => {
  if (!rule.enabled) return false;
  const req = rule.unlockRequestedAt ?? null;
  if (!req) return true;
  return unlockMsRemaining(req, now) > 0;
};

/** Drop expired unlock requests so stale cooling can never linger. */
const normalizeRule = <T extends { enabled: boolean; unlockRequestedAt: string | null }>(rule: T, now = Date.now()): T => {
  if (rule.enabled && rule.unlockRequestedAt && unlockMsRemaining(rule.unlockRequestedAt, now) <= 0) {
    return { ...rule, enabled: false, unlockRequestedAt: null };
  }
  return rule;
};

export const requestUnlock = <T extends { unlockRequestedAt: string | null }>(rule: T): T => ({
  ...rule,
  unlockRequestedAt: new Date().toISOString(),
});

export const cancelUnlockRequest = <T extends { unlockRequestedAt: string | null }>(rule: T): T => ({
  ...rule,
  unlockRequestedAt: null,
});

/** YYYY-MM-DD day key for a timestamp in the given IANA timezone. */
export const dayKeyInTz = (timestampMs: number, tz?: string): string => {
  const zone = tz || getDefaultTimezone();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
      new Date(timestampMs)
    );
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const d = new Date(timestampMs);
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
};

export type LockCheckInput = {
  symbolId: number | null;
  volumeLots: number;
  fillsToday: number;
  now?: number;
};

export type LockVerdict =
  | { allowed: true }
  | { allowed: false; rule: 'pairWhitelist' | 'maxTrades' | 'lotGuard'; message: string };

/**
 * Pure gate evaluated before any new-risk order is sent. Closes, SL/TP
 * modifies and cancels must NEVER pass through here.
 */
export const evaluateLocks = (locks: PortfolioLocks, input: LockCheckInput): LockVerdict => {
  const now = input.now ?? Date.now();

  if (isRuleActive(locks.pairWhitelist, now)) {
    const id = input.symbolId === null || input.symbolId === undefined ? NaN : Number(input.symbolId);
    if (!Number.isFinite(id) || !locks.pairWhitelist.symbolIds.map(Number).includes(id)) {
      return { allowed: false, rule: 'pairWhitelist', message: "This pair isn't on your allowed-pairs list for this portfolio." };
    }
  }

  if (isRuleActive(locks.maxTrades, now)) {
    const max = Math.max(1, Math.floor(Number(locks.maxTrades.maxPerDay) || 1));
    if (input.fillsToday >= max) {
      return { allowed: false, rule: 'maxTrades', message: `Daily limit reached (${input.fillsToday}/${max}) — resets 00:00.` };
    }
  }

  if (isRuleActive(locks.lotGuard, now)) {
    const vol = Number(input.volumeLots);
    const min = locks.lotGuard.minLots !== undefined ? Number(locks.lotGuard.minLots) : undefined;
    const max = locks.lotGuard.maxLots !== undefined ? Number(locks.lotGuard.maxLots) : undefined;
    if ((min !== undefined && Number.isFinite(min) && vol < min) || (max !== undefined && Number.isFinite(max) && vol > max)) {
      const range = `${min !== undefined && Number.isFinite(min) ? min : '…'}–${max !== undefined && Number.isFinite(max) ? max : '…'} lots`;
      return { allowed: false, rule: 'lotGuard', message: `Lot size ${Number.isFinite(vol) ? vol : '?'} is outside your allowed ${range}.` };
    }
  }

  return { allowed: true };
};

// --- Per-day lock stats ("this saved me N violations") ---

const statsKey = (portfolioId: string, dayKey: string) => `${STATS_PREFIX}${portfolioId}_${dayKey}`;

export const readLockStats = (portfolioId: string | null | undefined, dayKey: string): LockStats => {
  if (!portfolioId) return { blocks: 0, fills: 0 };
  const parsed = safeParse(storage.get(statsKey(portfolioId, dayKey)) as string | null) as unknown as LockStats | null;
  if (!parsed) return { blocks: 0, fills: 0 };
  return {
    blocks: Number.isFinite(Number(parsed.blocks)) ? Number(parsed.blocks) : 0,
    fills: Number.isFinite(Number(parsed.fills)) ? Number(parsed.fills) : 0,
  };
};

export const bumpLockStat = (portfolioId: string | null | undefined, dayKey: string, field: 'blocks' | 'fills'): LockStats => {
  const current = readLockStats(portfolioId, dayKey);
  const next = { ...current, [field]: current[field] + 1 };
  if (portfolioId) storage.set(statsKey(portfolioId, dayKey), JSON.stringify(next));
  return next;
};

/** Human "13:22:10" countdown for an unlock request. */
export const formatUnlockCountdown = (unlockRequestedAt: string | null | undefined, now = Date.now()): string => {
  const ms = Math.max(0, unlockMsRemaining(unlockRequestedAt, now));
  const s = Math.floor(ms / 1000);
  const h = `${Math.floor(s / 3600)}`.padStart(2, '0');
  const m = `${Math.floor((s % 3600) / 60)}`.padStart(2, '0');
  const sec = `${s % 60}`.padStart(2, '0');
  return `${h}:${m}:${sec}`;
};

/**
 * Positions opened today (account scope): currently-open positions with
 * today's openTimestamp + closed deals with today's openTimestamp.
 * Rejected orders create neither, pending orders are excluded — only fills.
 */
export const countOpensToday = async (
  ctidAccountId: string | number | null | undefined,
  isDemo: boolean,
  tz?: string,
  now = Date.now()
): Promise<number> => {
  const n = Number(ctidAccountId);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const today = dayKeyInTz(now, tz);
  const isToday = (ts: unknown): boolean => {
    const t = typeof ts === 'number' ? ts : Date.parse(String(ts ?? ''));
    return Number.isFinite(t) && dayKeyInTz(t, tz) === today;
  };
  try {
    const svc = await import('../services/ctraderService');
    const [positions, deals] = await Promise.all([
      svc.getPositions(n, isDemo).catch(() => [] as any[]),
      svc.getClosedDeals(n, undefined, undefined, isDemo).catch(() => [] as any[]),
    ]);
    const openNow = (positions || []).filter((p: any) => isToday(p?.openTimestamp)).length;
    const opened = (deals || []).filter((d: any) => isToday(d?.openTimestamp)).length;
    return openNow + opened;
  } catch {
    return 0;
  }
};
