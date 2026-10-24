import { getDefaultTimezone } from './timeUtils';

/** Cooling-off period before a requested unlock or loosen takes effect. */
export const LOCK_UNLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const LOCKS_KEY = 'jfx_trading_locks_v1';
const STATS_PREFIX = 'jfx_lock_stats_';

export interface PendingChange<T> {
  value: T;
  requestedAt: string;
}

export interface PairWhitelistRule {
  enabled: boolean;
  /** Stable cTrader symbolIds (immune to ".0" renames). */
  symbolIds: number[];
  /** Name snapshot per symbolId for display. */
  symbolNames: Record<number, string>;
  unlockRequestedAt: string | null;
  pendingChange?: PendingChange<{ symbolIds?: number[]; symbolNames?: Record<number, string> }> | null;
}

export interface MaxTradesRule {
  enabled: boolean;
  maxPerDay: number;
  unlockRequestedAt: string | null;
  pendingChange?: PendingChange<{ maxPerDay?: number }> | null;
}

export interface LotGuardRule {
  enabled: boolean;
  minLots?: number;
  maxLots?: number;
  unlockRequestedAt: string | null;
  /** null clears that bound when the pending change takes effect. */
  pendingChange?: PendingChange<{ minLots?: number | null; maxLots?: number | null }> | null;
}

export interface PortfolioLocks {
  pairWhitelist: PairWhitelistRule;
  maxTrades: MaxTradesRule;
  lotGuard: LotGuardRule;
  updatedAt: string;
}

export type TradingLocksStore = Record<string, PortfolioLocks>;

export const LOCK_RULE_KEYS = ['pairWhitelist', 'maxTrades', 'lotGuard'] as const;
export type LockRuleKey = (typeof LOCK_RULE_KEYS)[number];

export const LOCK_RULE_LABELS: Record<LockRuleKey, string> = {
  pairWhitelist: 'Allowed pairs',
  maxTrades: 'Max trades per day',
  lotGuard: 'Lot size limits',
};

export interface ElapsedLockChange {
  rule: LockRuleKey;
  requestedAt: string;
  description: string;
  dedupeKey: string;
}

export interface LockStats {
  blocks: number;
  fills: number;
}

export const blankPortfolioLocks = (): PortfolioLocks => ({
  pairWhitelist: { enabled: false, symbolIds: [], symbolNames: {}, unlockRequestedAt: null, pendingChange: null },
  maxTrades: { enabled: false, maxPerDay: 2, unlockRequestedAt: null, pendingChange: null },
  lotGuard: { enabled: false, minLots: undefined, maxLots: undefined, unlockRequestedAt: null, pendingChange: null },
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

/**
 * Raw local cache entry (pending changes still attached). Use this when a
 * caller must detect a pending change *before* normalization clears it.
 */
export const readStoredPortfolioLocks = (portfolioId: string | null | undefined): PortfolioLocks | null => {
  if (!portfolioId) return null;
  return readLocks()[portfolioId] ?? null;
};

export const readPortfolioLocks = (portfolioId: string | null | undefined): PortfolioLocks => {
  // No local entry: use a blank with an epoch timestamp so a cloud row (or a
  // blank local cache) always wins the updatedAt merge instead of "now".
  const empty = { ...blankPortfolioLocks(), updatedAt: new Date(0).toISOString() };
  if (!portfolioId) return empty;
  const found = readStoredPortfolioLocks(portfolioId);
  if (!found) return empty;
  return normalizePortfolioLocks(found);
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

/**
 * A pending loosen binds only after its own 24h wait. Timestamps in the
 * future are ignored (never clamped down to "now", which would shorten the
 * wait); malformed timestamps never apply.
 */
export const pendingChangeElapsed = (
  change: { requestedAt?: string | null } | null | undefined,
  now = Date.now()
): boolean => {
  if (!change?.requestedAt) return false;
  const t = Date.parse(change.requestedAt);
  if (!Number.isFinite(t)) return false;
  if (t > now) return false;
  return t + LOCK_UNLOCK_COOLDOWN_MS <= now;
};

const pairDescription = (value: { symbolIds?: number[]; symbolNames?: Record<number, string> } | null | undefined): string => {
  const rawIds = Array.isArray(value?.symbolIds) ? value?.symbolIds : [];
  const ids = uniqueIds(rawIds);
  const names = ids
    .map((id) => value?.symbolNames?.[id])
    .filter((name): name is string => Boolean(name));
  if (names.length > 0 && names.length <= 3) return `Allowed pairs are now ${names.join(', ')}`;
  return `Allowed pairs updated to ${pairCountLabel(ids.length)}`;
};

/** Human description of the loosening a pending change will apply. */
export const pendingChangeDescription = (
  rule: LockRuleKey,
  value: PendingChange<unknown>['value'] | null | undefined
): string => {
  if (rule === 'pairWhitelist') {
    return pairDescription(value as { symbolIds?: number[]; symbolNames?: Record<number, string> } | null);
  }
  if (rule === 'maxTrades') {
    const max = Math.max(1, Math.floor(Number((value as { maxPerDay?: number } | null)?.maxPerDay) || 1));
    return `Max trades per day is now ${max}`;
  }
  const lot = value as { minLots?: number | null; maxLots?: number | null } | null;
  const min = finiteBound(lot?.minLots);
  const max = finiteBound(lot?.maxLots);
  return `Lot limits are now ${min ?? '…'}–${max ?? '…'} lots`;
};

const LOCK_CHANGE_NOTICE_PREFIX = 'jfx_lock_change_notified_v1';

export const lockChangeDedupeKey = (portfolioId: string, rule: LockRuleKey, requestedAt: string): string =>
  `${LOCK_CHANGE_NOTICE_PREFIX}:${portfolioId}:${rule}:${requestedAt}`;

export const hasNotifiedLockChange = (key: string): boolean => storage.get(key) !== null;

export const markLockChangeNotified = (key: string): void => {
  storage.set(key, new Date().toISOString());
};

/**
 * Pending loosening changes that should already be in force. The caller is
 * responsible for normalizing/writing the lock row; this helper only reports
 * what elapsed so notifications can be raised before the pending value is
 * cleared.
 */
export const collectElapsedLockChanges = (
  portfolioId: string,
  locks: PortfolioLocks | null | undefined,
  now = Date.now()
): ElapsedLockChange[] => {
  if (!portfolioId || !locks) return [];
  const changes: ElapsedLockChange[] = [];
  for (const rule of LOCK_RULE_KEYS) {
    // A disabled/unlocked rule normalizes its pending change away, so there is
    // nothing to announce even if an old cache entry still carries one.
    if (!isRuleActive(locks[rule], now)) continue;
    const pending = locks[rule]?.pendingChange;
    if (!pending || !pendingChangeElapsed(pending, now)) continue;
    changes.push({
      rule,
      requestedAt: pending.requestedAt,
      description: pendingChangeDescription(rule, pending.value),
      dedupeKey: lockChangeDedupeKey(portfolioId, rule, pending.requestedAt),
    });
  }
  return changes;
};

/**
 * Applies elapsed pending changes to the local cache (so the new limits bind
 * even when no lock screen is open) and returns what changed.
 */
export const applyElapsedLockChanges = (portfolioId: string, now = Date.now()): ElapsedLockChange[] => {
  const raw = readStoredPortfolioLocks(portfolioId);
  if (!raw) return [];
  const changes = collectElapsedLockChanges(portfolioId, raw, now);
  if (changes.length === 0) return [];
  writePortfolioLocks(portfolioId, normalizePortfolioLocks(raw, now));
  return changes;
};

const normalizeBase = <T extends { enabled: boolean; unlockRequestedAt: string | null; pendingChange?: any }>(
  rule: T,
  now: number
): T => {
  if (!rule.enabled) return { ...rule, pendingChange: null };
  if (rule.unlockRequestedAt && unlockMsRemaining(rule.unlockRequestedAt, now) <= 0) {
    return { ...rule, enabled: false, unlockRequestedAt: null, pendingChange: null };
  }
  if (rule.pendingChange && !Number.isFinite(Date.parse(rule.pendingChange.requestedAt))) {
    return { ...rule, pendingChange: null };
  }
  return rule;
};

const uniqueIds = (ids: unknown): number[] => {
  const out: number[] = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = Number(raw);
    if (Number.isFinite(id) && !out.includes(id)) out.push(id);
  }
  return out;
};

const pickNames = (ids: number[], names: Record<number, string> | undefined): Record<number, string> => {
  const out: Record<number, string> = {};
  if (!names) return out;
  for (const id of ids) {
    const name = (names as any)[id];
    if (name) out[id] = String(name);
  }
  return out;
};

const normalizePairWhitelist = (rule: PairWhitelistRule, now: number): PairWhitelistRule => {
  const base = normalizeBase(rule, now);
  const change = base.pendingChange;
  if (!change || !pendingChangeElapsed(change, now)) return base;
  const value = change.value || {};
  const nextIds = Array.isArray(value.symbolIds) ? uniqueIds(value.symbolIds) : base.symbolIds;
  // An active rule must never end up with an empty whitelist (that would
  // block every pair); keep the last current set instead.
  const symbolIds = nextIds.length === 0 && base.symbolIds.length > 0 ? base.symbolIds : nextIds;
  const symbolNames = value.symbolNames && typeof value.symbolNames === 'object'
    ? { ...base.symbolNames, ...value.symbolNames }
    : base.symbolNames;
  return { ...base, symbolIds, symbolNames, pendingChange: null };
};

const normalizeMaxTrades = (rule: MaxTradesRule, now: number): MaxTradesRule => {
  const base = normalizeBase(rule, now);
  const change = base.pendingChange;
  if (!change || !pendingChangeElapsed(change, now)) return base;
  const pendingMax = Number(change.value?.maxPerDay);
  if (!Number.isFinite(pendingMax)) return { ...base, pendingChange: null };
  return { ...base, maxPerDay: Math.max(1, Math.floor(pendingMax)), pendingChange: null };
};

const finiteBound = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const normalizeLotGuard = (rule: LotGuardRule, now: number): LotGuardRule => {
  const base = normalizeBase(rule, now);
  const change = base.pendingChange;
  if (!change || !pendingChangeElapsed(change, now)) return base;
  const value = change.value || {};
  const next: LotGuardRule = { ...base, pendingChange: null };
  if (Object.prototype.hasOwnProperty.call(value, 'minLots')) next.minLots = finiteBound(value.minLots);
  if (Object.prototype.hasOwnProperty.call(value, 'maxLots')) next.maxLots = finiteBound(value.maxLots);
  return next;
};

/** Merge elapsed pending changes and drop expired cooling requests. */
export const normalizePortfolioLocks = (locks: PortfolioLocks, now = Date.now()): PortfolioLocks => {
  const blank = blankPortfolioLocks();
  return {
    ...locks,
    pairWhitelist: normalizePairWhitelist({ ...blank.pairWhitelist, ...(locks?.pairWhitelist || {}) }, now),
    maxTrades: normalizeMaxTrades({ ...blank.maxTrades, ...(locks?.maxTrades || {}) }, now),
    lotGuard: normalizeLotGuard({ ...blank.lotGuard, ...(locks?.lotGuard || {}) }, now),
    updatedAt: locks?.updatedAt || blank.updatedAt,
  };
};

export const requestUnlock = <T extends { unlockRequestedAt: string | null }>(rule: T): T => ({
  ...rule,
  unlockRequestedAt: new Date().toISOString(),
});

export const cancelUnlockRequest = <T extends { unlockRequestedAt: string | null }>(rule: T): T => ({
  ...rule,
  unlockRequestedAt: null,
});

export const cancelPendingChange = <T extends { pendingChange?: unknown }>(rule: T): T => ({
  ...rule,
  pendingChange: null,
});

/**
 * "Tighten now, loosen later" for Max trades per day.
 * The latest same-field edit always wins; lowering the limit applies
 * immediately and cancels a pending raise.
 */
export const editMaxTrades = (rule: MaxTradesRule, desiredMax: number, now = Date.now()): MaxTradesRule => {
  const base = normalizeMaxTrades(rule, now);
  const desired = Math.max(1, Math.floor(Number(desiredMax) || 1));
  if (!isRuleActive(base, now)) return { ...base, maxPerDay: desired, pendingChange: null };

  const current = Math.max(1, Math.floor(Number(base.maxPerDay) || 1));
  if (desired <= current) return { ...base, maxPerDay: desired, pendingChange: null };

  const previous = base.pendingChange;
  if (!previous) {
    return { ...base, pendingChange: { value: { maxPerDay: desired }, requestedAt: new Date(now).toISOString() } };
  }
  const previousValue = Math.max(1, Math.floor(Number(previous.value?.maxPerDay) || current));
  const requestedAt = desired > previousValue ? new Date(now).toISOString() : previous.requestedAt;
  return { ...base, pendingChange: { value: { maxPerDay: desired }, requestedAt } };
};

/**
 * "Tighten now, loosen later" for the lot range.
 * Only the fields present in `desired` are edited, so a tightening edit to
 * one bound never discards a pending loosening of the other.
 */
export const editLotGuard = (
  rule: LotGuardRule,
  desired: { minLots?: number | null; maxLots?: number | null },
  now = Date.now()
): LotGuardRule => {
  const base = normalizeLotGuard(rule, now);
  const hasMin = Object.prototype.hasOwnProperty.call(desired, 'minLots');
  const hasMax = Object.prototype.hasOwnProperty.call(desired, 'maxLots');

  if (!isRuleActive(base, now)) {
    const next: LotGuardRule = { ...base, pendingChange: null };
    if (hasMin) next.minLots = finiteBound(desired.minLots);
    if (hasMax) next.maxLots = finiteBound(desired.maxLots);
    return next;
  }

  const next: LotGuardRule = { ...base };
  const pendingValue: { minLots?: number | null; maxLots?: number | null } = { ...(base.pendingChange?.value || {}) };
  let requestedAt = base.pendingChange?.requestedAt;
  let resetTimer = false;

  const updateBound = (
    field: 'minLots' | 'maxLots',
    present: boolean,
    desiredRaw: number | null | undefined,
    tighter: (desired: number, current: number) => boolean,
    looser: (desired: number | undefined, current: number) => boolean
  ) => {
    if (!present) return;
    const current = finiteBound(base[field]);
    const desiredBound = finiteBound(desiredRaw);
    const pendingHas = Object.prototype.hasOwnProperty.call(pendingValue, field);
    const previousPending = pendingHas ? finiteBound(pendingValue[field]) : undefined;

    if (desiredBound === current) {
      if (pendingHas) delete pendingValue[field];
      return;
    }
    if (desiredBound !== undefined && (current === undefined || tighter(desiredBound, current))) {
      next[field] = desiredBound;
      if (pendingHas) delete pendingValue[field];
      return;
    }
    pendingValue[field] = desiredBound === undefined ? null : desiredBound;
    if (!pendingHas) resetTimer = true;
    else if (desiredBound === undefined) {
      if (previousPending !== undefined) resetTimer = true;
    } else if (previousPending !== undefined && looser(desiredBound, previousPending)) {
      resetTimer = true;
    }
  };

  updateBound('minLots', hasMin, desired.minLots, (d, c) => d > c, (d, c) => d === undefined || d < c);
  updateBound('maxLots', hasMax, desired.maxLots, (d, c) => d < c, (d, c) => d === undefined || d > c);

  if (Object.keys(pendingValue).length === 0) {
    next.pendingChange = null;
  } else {
    next.pendingChange = {
      value: pendingValue,
      requestedAt: resetTimer || !requestedAt ? new Date(now).toISOString() : requestedAt,
    };
  }
  return next;
};

/**
 * "Tighten now, loosen later" for the pair whitelist.
 * Removing a pair applies immediately, adding one waits 24h. At least one
 * currently-allowed pair must remain while the rule is on.
 */
export const editPairWhitelist = (
  rule: PairWhitelistRule,
  desired: { symbolIds: number[]; symbolNames?: Record<number, string> },
  now = Date.now()
): PairWhitelistRule => {
  const base = normalizePairWhitelist(rule, now);
  const desiredIds = uniqueIds(desired.symbolIds);
  const names = { ...(base.symbolNames || {}), ...(desired.symbolNames || {}) };

  if (!isRuleActive(base, now)) {
    return { ...base, symbolIds: desiredIds, symbolNames: pickNames(desiredIds, names), pendingChange: null };
  }

  const currentIds = uniqueIds(base.symbolIds);
  const desiredSet = new Set(desiredIds);
  const retained = currentIds.filter((id) => desiredSet.has(id));
  if (currentIds.length > 0 && retained.length === 0) return base;

  const additions = desiredIds.filter((id) => !currentIds.includes(id));
  const next = { ...base, symbolIds: retained, symbolNames: pickNames(desiredIds, names) };
  if (additions.length === 0) return { ...next, pendingChange: null };

  const previous = base.pendingChange;
  const previousIds = previous ? uniqueIds(previous.value?.symbolIds) : [];
  const allPreviouslyPending = desiredIds.every((id) => previousIds.includes(id));
  return {
    ...next,
    pendingChange: {
      value: { symbolIds: desiredIds, symbolNames: pickNames(desiredIds, names) },
      requestedAt: previous && allPreviouslyPending ? previous.requestedAt : new Date(now).toISOString(),
    },
  };
};

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

const tzOffsetMs = (tz: string, ts: number): number => {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(ts));
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const wall = Date.UTC(
      Number(get('year')),
      Number(get('month')) - 1,
      Number(get('day')),
      Number(get('hour')) % 24,
      Number(get('minute')),
      Number(get('second'))
    );
    return wall - ts;
  } catch {
    return 0;
  }
};

/** UTC ms range [start, end) for the local day containing `timestampMs`. */
export const dayBoundsInTz = (timestampMs: number, tz?: string): { start: number; end: number } => {
  const zone = tz || getDefaultTimezone();
  const key = dayKeyInTz(timestampMs, zone);
  const [y, m, d] = key.split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) {
    const start = new Date(timestampMs).setHours(0, 0, 0, 0);
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }
  const startGuess = Date.UTC(y, m - 1, d);
  const endGuess = Date.UTC(y, m - 1, d + 1);
  return { start: startGuess - tzOffsetMs(zone, startGuess), end: endGuess - tzOffsetMs(zone, endGuess) };
};

/** Short timezone label (SAST, EDT, …) with the IANA id as a fallback. */
export const shortTimezoneName = (tz?: string, at = Date.now()): string => {
  const zone = tz || getDefaultTimezone();
  for (const locale of ['en-ZA', 'en-GB', 'en-US']) {
    try {
      const parts = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(at));
      const name = parts.find((p) => p.type === 'timeZoneName')?.value || '';
      if (name && !/^(GMT|UTC)/i.test(name)) return name;
    } catch {
      /* try the next locale */
    }
  }
  return zone;
};

/** "1 pair" / "N pairs" — keeps the card copy grammatical. */
export const pairCountLabel = (count: number): string => {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return `${n} ${n === 1 ? 'pair' : 'pairs'}`;
};

export type LockCheckInput = {
  symbolId: number | null;
  volumeLots: number;
  fillsToday: number | null;
  timezone?: string;
  now?: number;
};

export type LockVerdict =
  | { allowed: true }
  | { allowed: false; rule: 'pairWhitelist' | 'maxTrades' | 'lotGuard'; message: string; reason?: 'count_unavailable' };

/**
 * Pure gate evaluated before any new-risk order is sent. Closes, SL/TP
 * modifies and cancels must NEVER pass through here.
 */
export const evaluateLocks = (locks: PortfolioLocks, input: LockCheckInput): LockVerdict => {
  const now = input.now ?? Date.now();
  const effective = normalizePortfolioLocks(locks, now);

  if (isRuleActive(effective.pairWhitelist, now)) {
    const id = input.symbolId === null || input.symbolId === undefined ? NaN : Number(input.symbolId);
    if (!Number.isFinite(id) || !effective.pairWhitelist.symbolIds.map(Number).includes(id)) {
      return { allowed: false, rule: 'pairWhitelist', message: "This pair isn't on your allowed-pairs list for this portfolio." };
    }
  }

  if (isRuleActive(effective.maxTrades, now)) {
    const max = Math.max(1, Math.floor(Number(effective.maxTrades.maxPerDay) || 1));
    if (input.fillsToday === null || input.fillsToday === undefined || !Number.isFinite(Number(input.fillsToday))) {
      return {
        allowed: false,
        rule: 'maxTrades',
        reason: 'count_unavailable',
        message: "Couldn't confirm today's trade count. Try again in a moment.",
      };
    }
    if (input.fillsToday >= max) {
      return {
        allowed: false,
        rule: 'maxTrades',
        message: `Daily limit reached (${input.fillsToday}/${max}) — resets 00:00 ${shortTimezoneName(input.timezone, now)}.`,
      };
    }
  }

  if (isRuleActive(effective.lotGuard, now)) {
    const vol = Number(input.volumeLots);
    const min = finiteBound(effective.lotGuard.minLots);
    const max = finiteBound(effective.lotGuard.maxLots);
    if (min !== undefined && max !== undefined && min > max) {
      return {
        allowed: false,
        rule: 'lotGuard',
        message: 'Lot limits are invalid (min above max). Fix them in Trading Locks.',
      };
    }
    if ((min !== undefined && vol < min) || (max !== undefined && vol > max)) {
      const range = `${min !== undefined ? min : '…'}–${max !== undefined ? max : '…'} lots`;
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
 * Returns null when the count cannot be confirmed (never 0 on failure).
 */
export const countOpensToday = async (
  ctidAccountId: string | number | null | undefined,
  isDemo: boolean,
  tz?: string,
  now = Date.now()
): Promise<number | null> => {
  const n = Number(ctidAccountId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const today = dayKeyInTz(now, tz);
  const isToday = (ts: unknown): boolean => {
    const t = typeof ts === 'number' ? ts : Date.parse(String(ts ?? ''));
    return Number.isFinite(t) && dayKeyInTz(t, tz) === today;
  };
  try {
    const svc = await import('../services/ctraderService');
    const [positionsResult, dealsResult] = await Promise.allSettled([
      svc.getPositions(n, isDemo),
      svc.getClosedDeals(n, undefined, undefined, isDemo),
    ]);
    if (positionsResult.status !== 'fulfilled' || dealsResult.status !== 'fulfilled') return null;
    const positions = positionsResult.value || [];
    const deals = dealsResult.value || [];
    const openNow = positions.filter((p: any) => isToday(p?.openTimestamp)).length;
    const opened = deals.filter((d: any) => isToday(d?.openTimestamp)).length;
    return openNow + opened;
  } catch {
    return null;
  }
};
