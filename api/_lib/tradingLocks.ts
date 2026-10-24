/**
 * Server-side mirror of the trading-locks discipline feature
 * (see lib/tradingLocks.ts — client copy).
 *
 * Rules are created in Settings → Rules & Checklists and mirrored to the
 * `portfolio_locks` table so agent/API order paths cannot bypass them.
 * Closes, SL/TP modifies and cancels are NEVER gated — only new risk.
 */

export const LOCK_UNLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TZ = 'Africa/Johannesburg';

export interface PendingChange<T> {
  value: T;
  requestedAt: string;
}

export interface LockRule {
  enabled: boolean;
  unlockRequestedAt?: string | null;
  pendingChange?: PendingChange<any> | null;
}

export interface PortfolioLocks {
  pairWhitelist?: {
    enabled: boolean;
    symbolIds: number[];
    symbolNames?: Record<number, string>;
    unlockRequestedAt?: string | null;
    pendingChange?: PendingChange<{ symbolIds?: number[]; symbolNames?: Record<number, string> }> | null;
  };
  maxTrades?: {
    enabled: boolean;
    maxPerDay: number;
    unlockRequestedAt?: string | null;
    pendingChange?: PendingChange<{ maxPerDay?: number }> | null;
  };
  lotGuard?: {
    enabled: boolean;
    minLots?: number;
    maxLots?: number;
    unlockRequestedAt?: string | null;
    pendingChange?: PendingChange<{ minLots?: number | null; maxLots?: number | null }> | null;
  };
  updatedAt?: string;
}

export function unlockMsRemaining(unlockRequestedAt: string | null | undefined, now = Date.now()): number {
  if (!unlockRequestedAt) return 0;
  const t = Date.parse(unlockRequestedAt);
  if (!Number.isFinite(t)) return 0;
  return t + LOCK_UNLOCK_COOLDOWN_MS - now;
}

/**
 * A rule binds while enabled — INCLUDING during a cooling countdown.
 * Toggling a rule off starts 24h of continued enforcement; only after the
 * countdown elapses does the rule drop.
 */
export function isRuleActive(rule: LockRule | undefined, now = Date.now()): boolean {
  if (!rule || !rule.enabled) return false;
  const req = rule.unlockRequestedAt ?? null;
  if (!req) return true;
  return unlockMsRemaining(req, now) > 0;
}

/**
 * A pending loosen applies only after its own 24h wait. Future timestamps
 * are ignored rather than clamped down to "now" (clamping would shorten the
 * wait); malformed timestamps never apply either.
 */
export function pendingChangeElapsed(
  change: { requestedAt?: string | null } | null | undefined,
  now = Date.now()
): boolean {
  if (!change?.requestedAt) return false;
  const t = Date.parse(change.requestedAt);
  if (!Number.isFinite(t)) return false;
  if (t > now) return false;
  return t + LOCK_UNLOCK_COOLDOWN_MS <= now;
}

const normalizeBase = <T extends LockRule>(rule: T, now: number): T => {
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

const normalizePairWhitelist = (
  rule: NonNullable<PortfolioLocks['pairWhitelist']>,
  now: number
): NonNullable<PortfolioLocks['pairWhitelist']> => {
  const base = normalizeBase(rule, now);
  const change = base.pendingChange;
  if (!change || !pendingChangeElapsed(change, now)) return base;
  const value = change.value || {};
  const nextIds = Array.isArray(value.symbolIds) ? uniqueIds(value.symbolIds) : base.symbolIds;
  // An active rule must never end up with an empty whitelist (that would
  // block every pair); keep the last current set instead.
  const symbolIds = nextIds.length === 0 && base.symbolIds.length > 0 ? base.symbolIds : nextIds;
  const symbolNames = value.symbolNames && typeof value.symbolNames === 'object'
    ? { ...(base.symbolNames || {}), ...value.symbolNames }
    : base.symbolNames;
  return { ...base, symbolIds, symbolNames, pendingChange: null };
};

const normalizeMaxTrades = (
  rule: NonNullable<PortfolioLocks['maxTrades']>,
  now: number
): NonNullable<PortfolioLocks['maxTrades']> => {
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

const normalizeLotGuard = (
  rule: NonNullable<PortfolioLocks['lotGuard']>,
  now: number
): NonNullable<PortfolioLocks['lotGuard']> => {
  const base = normalizeBase(rule, now);
  const change = base.pendingChange;
  if (!change || !pendingChangeElapsed(change, now)) return base;
  const value = change.value || {};
  const next: NonNullable<PortfolioLocks['lotGuard']> = { ...base, pendingChange: null };
  if (Object.prototype.hasOwnProperty.call(value, 'minLots')) next.minLots = finiteBound(value.minLots);
  if (Object.prototype.hasOwnProperty.call(value, 'maxLots')) next.maxLots = finiteBound(value.maxLots);
  return next;
};

/** Merge elapsed pending changes and drop expired cooling requests. */
export function normalizeLocks(locks: PortfolioLocks | null | undefined, now = Date.now()): PortfolioLocks | null {
  if (!locks) return null;
  return {
    ...locks,
    pairWhitelist: locks.pairWhitelist ? normalizePairWhitelist(locks.pairWhitelist, now) : locks.pairWhitelist,
    maxTrades: locks.maxTrades ? normalizeMaxTrades(locks.maxTrades, now) : locks.maxTrades,
    lotGuard: locks.lotGuard ? normalizeLotGuard(locks.lotGuard, now) : locks.lotGuard,
  };
}

/** Short timezone label (SAST, EDT, …) with the IANA id as a fallback. */
export function shortTimezoneName(tz?: string, at = Date.now()): string {
  const zone = tz || FALLBACK_TZ;
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
}

export function dayKeyInTz(timestampMs: number, tz?: string): string {
  const zone = tz || FALLBACK_TZ;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestampMs));
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const d = new Date(timestampMs);
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  }
}

function tzOffsetMs(tz: string, ts: number): number {
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
    const wall = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(get('hour')) % 24, Number(get('minute')), Number(get('second')));
    return wall - ts;
  } catch {
    return 0;
  }
}

/** UTC ms of local-midnight starting `dayKey` (YYYY-MM-DD) in `tz`. */
export function startOfDayMs(dayKey: string, tz: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return Date.now();
  const guess = Date.UTC(y, m - 1, d);
  return guess - tzOffsetMs(tz, guess);
}

export type LockVerdict =
  | { allowed: true }
  | { allowed: false; rule: 'pairWhitelist' | 'maxTrades' | 'lotGuard'; message: string; reason?: 'count_unavailable' };

export function evaluateLocks(
  locks: PortfolioLocks | null | undefined,
  input: { symbolId: number | null; volumeLots: number; fillsToday: number | null; timezone?: string },
  now = Date.now()
): LockVerdict {
  if (!locks) return { allowed: true };
  const effective = normalizeLocks(locks, now) || locks;

  if (isRuleActive(effective.pairWhitelist, now)) {
    const id = Number(input.symbolId);
    const allowed = (effective.pairWhitelist?.symbolIds || []).map(Number);
    if (!Number.isFinite(id) || !allowed.includes(id)) {
      return { allowed: false, rule: 'pairWhitelist', message: "This pair isn't on the portfolio's allowed-pairs list." };
    }
  }

  if (isRuleActive(effective.maxTrades, now)) {
    const max = Math.max(1, Math.floor(Number(effective.maxTrades?.maxPerDay) || 1));
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
    const min = finiteBound(effective.lotGuard?.minLots);
    const max = finiteBound(effective.lotGuard?.maxLots);
    if (min !== undefined && max !== undefined && min > max) {
      return {
        allowed: false,
        rule: 'lotGuard',
        message: 'Lot limits are invalid (min above max). Fix them in Trading Locks.',
      };
    }
    if ((min !== undefined && vol < min) || (max !== undefined && vol > max)) {
      return { allowed: false, rule: 'lotGuard', message: `Lot size ${Number.isFinite(vol) ? vol : '?'} is outside the allowed range.` };
    }
  }

  return { allowed: true };
}

type RestDeps = { supabaseUrl: string; serviceKey: string };

const restHeaders = (serviceKey: string) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
});

async function restGet(deps: RestDeps, path: string): Promise<any> {
  const res = await fetch(`${deps.supabaseUrl}/rest/v1/${path}`, { headers: restHeaders(deps.serviceKey) });
  if (!res.ok) throw new Error(`rest ${res.status}`);
  return res.json().catch(() => null);
}

export interface PortfolioBinding {
  id: string;
  name: string | null;
  isDefault: boolean;
  isArchived: boolean;
  createdAt: string | null;
}

const linkedToAccount = (accounts: any, accountId: number): boolean =>
  (accounts || []).some(
    (a: any) => a?.provider === 'ctrader' && String(a?.externalAccountId) === String(accountId)
  );

/**
 * All portfolios bound to a cTrader account, sorted deterministically:
 * live before archived, default first, then oldest. Pure (testable) —
 * pass raw `portfolios` rows.
 */
export function matchPortfoliosForAccount(rows: any[], accountId: number): PortfolioBinding[] {
  const out: PortfolioBinding[] = [];
  for (const r of rows || []) {
    if (!r?.id || !linkedToAccount(r?.accounts, accountId)) continue;
    out.push({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : null,
      isDefault: r.is_default === true,
      isArchived: r.is_archived === true,
      createdAt: typeof r.created_at === 'string' ? r.created_at : null,
    });
  }
  out.sort((a, b) => {
    if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  return out;
}

async function fetchPortfolioRows(deps: RestDeps, userId: string): Promise<any[] | null> {
  // Prefer the full select; fall back to the minimal one when the
  // dashboard-era table predates is_default/is_archived/created_at.
  try {
    const rows = await restGet(
      deps,
      `portfolios?user_id=eq.${encodeURIComponent(userId)}&select=id,name,is_default,is_archived,created_at,accounts`
    );
    if (Array.isArray(rows)) return rows;
  } catch { /* fall through to minimal select */ }
  try {
    const rows = await restGet(deps, `portfolios?user_id=eq.${encodeURIComponent(userId)}&select=id,accounts`);
    return Array.isArray(rows) ? rows : null;
  } catch (e) {
    console.warn('[locks] portfolio resolve failed (fail-open):', (e as Error)?.message);
    return null;
  }
}

/** All live bindings for an account (for collision flagging), or [] fail-open. */
export async function findPortfoliosForAccount(
  deps: RestDeps,
  userId: string,
  accountId: number
): Promise<PortfolioBinding[]> {
  const rows = await fetchPortfolioRows(deps, userId);
  if (!rows) return [];
  return matchPortfoliosForAccount(rows, accountId).filter((b) => !b.isArchived);
}

/** Portfolio whose linked cTrader account matches, or null (fail-open). */
export async function findPortfolioIdForAccount(
  deps: RestDeps,
  userId: string,
  accountId: number
): Promise<string | null> {
  const rows = await fetchPortfolioRows(deps, userId);
  if (!rows) return null;
  const live = matchPortfoliosForAccount(rows, accountId).filter((b) => !b.isArchived);
  const pick = live.length > 0 ? live[0] : matchPortfoliosForAccount(rows, accountId)[0];
  return pick ? pick.id : null;
}

/** Non-archived portfolios for account discovery (degrades to [] fail-open). */
export async function listPortfolios(
  deps: RestDeps,
  userId: string
): Promise<PortfolioBinding[]> {
  const rows = await fetchPortfolioRows(deps, userId);
  if (!rows) return [];
  return (rows || [])
    .filter((r: any) => r?.id && r?.is_archived !== true)
    .map((r: any) => ({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : null,
      isDefault: r.is_default === true,
      isArchived: false,
      createdAt: typeof r.created_at === 'string' ? r.created_at : null,
    }));
}

export interface PortfolioContext {
  portfolioId: string | null;
  portfolioName: string | null;
  /** Every live binding — length > 1 means a collision the caller should surface. */
  portfolioIds: string[];
  /** True when a portfolio binds but its locks row could not be read. */
  locksUnchecked: boolean;
  locks: PortfolioLocks | null;
}

/**
 * Attribution context for API responses: which portfolio (if any) binds an
 * account, and whether its locks could be evaluated. Fails open — never throws.
 */
export async function resolvePortfolioContext(
  deps: RestDeps,
  userId: string | null,
  accountId: number
): Promise<PortfolioContext> {
  const empty: PortfolioContext = {
    portfolioId: null,
    portfolioName: null,
    portfolioIds: [],
    locksUnchecked: false,
    locks: null,
  };
  if (!userId) return empty;
  try {
    const bindings = await findPortfoliosForAccount(deps, userId, accountId);
    if (bindings.length === 0) return empty;
    try {
      const locks = await fetchPortfolioLocksStrict(deps, userId, bindings[0].id);
      return {
        portfolioId: bindings[0].id,
        portfolioName: bindings[0].name,
        portfolioIds: bindings.map((b) => b.id),
        locksUnchecked: false,
        locks,
      };
    } catch {
      return {
        portfolioId: bindings[0].id,
        portfolioName: bindings[0].name,
        portfolioIds: bindings.map((b) => b.id),
        locksUnchecked: true,
        locks: null,
      };
    }
  } catch {
    return { ...empty, locksUnchecked: true };
  }
}

export interface PortfolioLockSummary {
  pairWhitelist: { active: boolean; symbolIds: number[]; cooldownMsRemaining: number };
  maxTrades: { active: boolean; maxPerDay: number | null; cooldownMsRemaining: number };
  lotGuard: {
    active: boolean;
    minLots: number | null;
    maxLots: number | null;
    cooldownMsRemaining: number;
  };
}

export interface PortfolioDetail extends PortfolioBinding {
  linkedCtraderAccountIds: string[];
  /** Null when no locks row exists or it could not be read (fail-open). */
  locks: PortfolioLockSummary | null;
}

const cooldownLeft = (rule: LockRule | undefined, now: number): number =>
  Math.max(0, unlockMsRemaining(rule?.unlockRequestedAt ?? null, now));

/** Full discovery payload for get_portfolios: bindings + lock summaries. */
export async function listPortfolioDetails(
  deps: RestDeps,
  userId: string,
  now = Date.now()
): Promise<PortfolioDetail[]> {
  const rows = await fetchPortfolioRows(deps, userId);
  if (!rows) return [];
  const live = (rows || []).filter((r: any) => r?.id && r?.is_archived !== true);
  const out: PortfolioDetail[] = [];
  for (const r of live) {
    const id = String(r.id);
    const linkedCtraderAccountIds = ((r as any)?.accounts || [])
      .filter((a: any) => a?.provider === 'ctrader' && a?.externalAccountId !== undefined && a?.externalAccountId !== null)
      .map((a: any) => String(a.externalAccountId));
    let locks: PortfolioLockSummary | null = null;
    try {
      const raw = await fetchPortfolioLocksStrict(deps, userId, id);
      const effective = raw ? normalizeLocks(raw, now) : null;
      if (effective) {
        locks = {
          pairWhitelist: {
            active: isRuleActive(effective.pairWhitelist, now),
            symbolIds: (effective.pairWhitelist?.symbolIds || []).map(Number).filter(Number.isFinite),
            cooldownMsRemaining: cooldownLeft(effective.pairWhitelist, now),
          },
          maxTrades: {
            active: isRuleActive(effective.maxTrades, now),
            maxPerDay: Number.isFinite(Number(effective.maxTrades?.maxPerDay))
              ? Math.max(1, Math.floor(Number(effective.maxTrades?.maxPerDay)))
              : null,
            cooldownMsRemaining: cooldownLeft(effective.maxTrades, now),
          },
          lotGuard: {
            active: isRuleActive(effective.lotGuard, now),
            minLots: Number.isFinite(Number(effective.lotGuard?.minLots)) ? Number(effective.lotGuard?.minLots) : null,
            maxLots: Number.isFinite(Number(effective.lotGuard?.maxLots)) ? Number(effective.lotGuard?.maxLots) : null,
            cooldownMsRemaining: cooldownLeft(effective.lotGuard, now),
          },
        };
      }
    } catch {
      locks = null;
    }
    out.push({
      id,
      name: typeof r.name === 'string' ? r.name : null,
      isDefault: r.is_default === true,
      isArchived: false,
      createdAt: typeof r.created_at === 'string' ? r.created_at : null,
      linkedCtraderAccountIds,
      locks,
    });
  }
  return out;
}

/** Locks row for (user, portfolio); throws on infra failure (use when the
 *  caller must distinguish "no locks configured" from "locks unreachable"). */
export async function fetchPortfolioLocksStrict(
  deps: RestDeps,
  userId: string,
  portfolioId: string
): Promise<PortfolioLocks | null> {
  const rows = await restGet(
    deps,
    `portfolio_locks?user_id=eq.${encodeURIComponent(userId)}&portfolio_id=eq.${encodeURIComponent(portfolioId)}&select=locks&limit=1`
  );
  const locks = Array.isArray(rows) ? rows[0]?.locks : null;
  return locks && typeof locks === 'object' ? (locks as PortfolioLocks) : null;
}

/** Locks row for (user, portfolio), or null when absent/unreachable (fail-open). */
export async function fetchPortfolioLocks(
  deps: RestDeps,
  userId: string,
  portfolioId: string
): Promise<PortfolioLocks | null> {
  try {
    return await fetchPortfolioLocksStrict(deps, userId, portfolioId);
  } catch (e) {
    // Missing table (migration not applied) must never block trading.
    console.warn('[locks] fetch failed (fail-open):', (e as Error)?.message);
    return null;
  }
}

export async function getUserTimezone(deps: RestDeps, userId: string): Promise<string> {
  try {
    const rows = await restGet(deps, `profiles?id=eq.${encodeURIComponent(userId)}&select=timezone&limit=1`);
    const tz = Array.isArray(rows) ? rows[0]?.timezone : null;
    return typeof tz === 'string' && tz ? tz : FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

export type BrokerSession = {
  send: (payloadType: number, payload: Record<string, any>) => Promise<any>;
};

const dealOpenTime = (deal: any): number | null => {
  const raw = deal?.closePositionDetail?.openTimestamp ?? deal?.tradeData?.openTimestamp ?? deal?.openTimestamp;
  if (raw === undefined || raw === null || raw === '') return null;
  const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
  return Number.isFinite(t) && t > 0 ? t : null;
};

/**
 * Positions opened today (account scope): open positions + closed deals
 * whose openTimestamp falls today in the user's timezone. Returns null when
 * the count cannot be confirmed (the caller blocks new opens if maxTrades
 * is active rather than guessing zero).
 */
export async function countOpensToday(
  session: BrokerSession,
  accountId: number,
  tz: string,
  now = Date.now()
): Promise<number | null> {
  try {
    const today = dayKeyInTz(now, tz);
    // Never substitute an empty deal list for a failed request: that would
    // undercount fills and let the maxTrades lock fail open.
    const [rec, dealsRes] = await Promise.all([
      session.send(2124, { ctidTraderAccountId: accountId }),
      session.send(2133, {
        ctidTraderAccountId: accountId,
        fromTimestamp: startOfDayMs(today, tz),
        toTimestamp: now,
      }),
    ]);
    const openNow = ((rec as any)?.position || []).filter((p: any) => {
      const ts = p?.tradeData?.openTimestamp;
      const t = typeof ts === 'number' ? ts : Date.parse(String(ts ?? ''));
      return Number.isFinite(t) && dayKeyInTz(t, tz) === today;
    }).length;
    const opened = (((dealsRes as any)?.deal) || []).filter((d: any) => {
      const t = dealOpenTime(d);
      return t !== null && dayKeyInTz(t, tz) === today;
    }).length;
    return openNow + opened;
  } catch (e) {
    console.warn('[locks] opens count unavailable:', (e as Error)?.message);
    return null;
  }
}

export function toLots(rawVolume: unknown): number {
  const v = Number(rawVolume);
  if (!Number.isFinite(v) || v <= 0) return 0.01;
  // Mirror toVolumeCents: >= 500 means units, else lots.
  return v >= 500 ? v / 100000 : v;
}
