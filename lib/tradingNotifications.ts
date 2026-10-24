/**
 * Trading event notifications shared by the desktop cTrader panels.
 *
 * Mobile (APK/web shell) keeps its existing toasts; this module adds the
 * desktop layer: in-app toasts plus the browser Notification API when the
 * user granted permission, and Capacitor LocalNotifications when running
 * inside the native shell. It never imports Capacitor — the native globals
 * are only probed defensively — so loading it on web can never throw.
 */

import {
  LOCK_RULE_KEYS,
  LOCK_RULE_LABELS,
  LOCK_UNLOCK_COOLDOWN_MS,
  applyElapsedLockChanges,
  hasNotifiedLockChange,
  markLockChangeNotified,
  pendingChangeDescription,
  pendingChangeElapsed,
  type LockRuleKey,
  type PortfolioLocks,
} from './tradingLocks';

export type TradingNotificationKind =
  | 'order_placed'
  | 'position_opened'
  | 'position_modified'
  | 'position_closed'
  | 'off_quotes'
  | 'requote'
  | 'invalid_stops'
  | 'insufficient_funds'
  | 'market_closed'
  | 'execution_failure'
  | 'locked_by_rule'
  | 'unknown';

export type TradingToastType = 'success' | 'error' | 'warning' | 'info';

export interface TradingNotificationContent {
  kind: TradingNotificationKind;
  title: string;
  message: string;
  toastType: TradingToastType;
}

export type TradingEvent =
  | { kind: 'order_placed'; title?: string; message?: string; alreadyToasted?: boolean }
  | { kind: 'position_opened'; title?: string; message?: string; alreadyToasted?: boolean }
  | { kind: 'position_modified'; title?: string; message?: string; alreadyToasted?: boolean }
  | { kind: 'position_closed'; title?: string; message?: string; alreadyToasted?: boolean }
  | { kind: 'error'; message: string; errorCode?: string; status?: number; alreadyToasted?: boolean };

export interface LockBlockContext {
  maxPerDay?: number;
  fillsToday?: number | null;
  minLots?: number;
  maxLots?: number;
  volumeLots?: number;
  allowedSymbolIds?: number[];
  reason?: string;
}

export interface LockBlockInput {
  rule?: string | null;
  message?: string | null;
  context?: LockBlockContext | null;
  symbolName?: string | null;
  volumeLots?: number | null;
  portfolioName?: string | null;
}

interface ContentSeed {
  title: string;
  toastType: TradingToastType;
  fallbackMessage: string;
}

const CONTENT: Record<TradingNotificationKind, ContentSeed> = {
  order_placed: { title: 'Order placed', toastType: 'success', fallbackMessage: 'Your market order was accepted.' },
  position_opened: { title: 'Position opened', toastType: 'success', fallbackMessage: 'A new position is now open.' },
  position_modified: { title: 'Position updated', toastType: 'success', fallbackMessage: 'Stop loss / take profit updated.' },
  position_closed: { title: 'Position closed', toastType: 'success', fallbackMessage: 'The position was closed at market.' },
  off_quotes: { title: 'Off quotes', toastType: 'warning', fallbackMessage: 'The broker is not quoting this symbol right now. Try again shortly.' },
  requote: { title: 'Requote', toastType: 'warning', fallbackMessage: 'The price moved before execution. Review the new quote and retry.' },
  invalid_stops: { title: 'Invalid stops', toastType: 'error', fallbackMessage: 'Stop loss or take profit is invalid for this symbol.' },
  insufficient_funds: { title: 'Insufficient funds', toastType: 'error', fallbackMessage: 'Not enough free margin to place this order.' },
  market_closed: { title: 'Market closed', toastType: 'warning', fallbackMessage: 'This market is closed. Try again when trading hours resume.' },
  execution_failure: { title: 'Execution failed', toastType: 'error', fallbackMessage: 'The broker rejected the request. Check the details and retry.' },
  locked_by_rule: { title: 'Blocked by trading lock', toastType: 'error', fallbackMessage: 'A trading lock blocked this order. Adjust it in Rules & Checklists.' },
  unknown: { title: 'Trading update', toastType: 'info', fallbackMessage: 'The broker returned an update for your request.' },
};

/** Map a broker/API error string onto a user-facing notification kind. */
export const classifyTradingError = (message: string | undefined | null, errorCode?: string | null): TradingNotificationKind => {
  if (errorCode === 'locked_by_rule') return 'locked_by_rule';
  const text = String(message || '');
  if (/locked_by_rule|blocked by trading lock|daily limit reached|allowed[- ]pairs|outside your allowed .*lots/i.test(text)) {
    return 'locked_by_rule';
  }
  if (/insufficient|not enough (free )?margin|no (free )?margin|margin (is )?too (low|high)/i.test(text)) {
    return 'insufficient_funds';
  }
  if (/invalid (stop|sl|tp)|invalid (stop loss|take profit)|stop loss.*(invalid|too close)|take profit.*(invalid|too close)|invalid stops?/i.test(text)) {
    return 'invalid_stops';
  }
  if (/market (is )?(closed|not available)|trading (is )?(closed|disabled)|outside (market )?(hours|session)/i.test(text)) {
    return 'market_closed';
  }
  if (/off[\s_-]?quotes?|no quotes?|quote (is )?unavailable/i.test(text)) {
    return 'off_quotes';
  }
  if (/requote|re-quote|quote (changed|moved)|price (changed|moved)/i.test(text)) {
    return 'requote';
  }
  if (/execution (failed|rejected)|order (failed|rejected)|trade (failed|rejected)|failed to (open|close|amend)|could not (open|close|amend)/i.test(text)) {
    return 'execution_failure';
  }
  return 'unknown';
};

export const tradingNotificationContent = (kind: TradingNotificationKind, message?: string, title?: string): TradingNotificationContent => {
  const seed = CONTENT[kind] || CONTENT.unknown;
  return {
    kind,
    title: title || seed.title,
    message: message && message.trim() ? message : seed.fallbackMessage,
    toastType: seed.toastType,
  };
};

const isLockRuleKey = (rule: string | null | undefined): rule is LockRuleKey =>
  rule === 'pairWhitelist' || rule === 'maxTrades' || rule === 'lotGuard';

export const lockRuleLabel = (rule: string | null | undefined): string =>
  isLockRuleKey(rule) ? LOCK_RULE_LABELS[rule] : 'Trading lock';

const finiteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const formatLots = (value: number | null): string => (value === null ? '…' : String(value));

/**
 * Builds the "Trade blocked by <rule>" notification. The rule key drives the
 * title; the server's structured context (when present) produces a concrete
 * reason such as "EURUSD not in allowed pairs" instead of a generic message.
 */
export const buildLockBlockContent = (input: LockBlockInput): TradingNotificationContent => {
  const fallback = CONTENT.locked_by_rule;
  const title = `Trade blocked by ${lockRuleLabel(input.rule)}`;
  const rawMessage = input.message && input.message.trim() ? input.message.trim() : '';

  let message = rawMessage || fallback.fallbackMessage;

  if (input.rule === 'pairWhitelist') {
    const pair = input.symbolName?.trim();
    if (pair) message = `${pair} not in allowed pairs`;
  } else if (input.rule === 'maxTrades') {
    if (input.context?.reason === 'count_unavailable' && rawMessage) {
      message = rawMessage;
    } else {
      const max = finiteNumber(input.context?.maxPerDay);
      const fills = finiteNumber(input.context?.fillsToday);
      if (max !== null) {
        message = `Max ${max} trades/day reached${fills !== null ? ` (${fills}/${max} today)` : ''}`;
      }
    }
  } else if (input.rule === 'lotGuard') {
    const min = finiteNumber(input.context?.minLots);
    const max = finiteNumber(input.context?.maxLots);
    const volume = finiteNumber(input.context?.volumeLots ?? input.volumeLots);
    if (min !== null || max !== null) {
      const range = `${formatLots(min)}–${formatLots(max)} lots`;
      message = volume !== null ? `Lot size ${volume} is outside ${range}` : `Allowed lot size is ${range}`;
    }
  }

  return {
    kind: 'locked_by_rule',
    title,
    message,
    toastType: fallback.toastType,
  };
};

export interface LockChangeNotificationContent extends TradingNotificationContent {
  description: string;
}

export const buildLockChangeContent = (description: string): LockChangeNotificationContent => ({
  kind: 'locked_by_rule',
  title: 'Lock change now active',
  message: description,
  toastType: 'info',
  description,
});

interface ToastLike {
  type: TradingToastType;
  title: string;
  message: string;
  duration?: number;
}

export interface TradingNotifyOptions {
  addToast?: (toast: ToastLike) => void;
  /** Disable the browser Notification API (tests / explicit user opt-out). */
  browserNotifications?: boolean;
}

const isNativeShell = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const capacitor = (window as any).Capacitor;
    return Boolean(capacitor?.isNativePlatform?.() || capacitor?.platform === 'android' || capacitor?.platform === 'ios');
  } catch {
    return false;
  }
};

const notificationPermission = (): NotificationPermission | 'unsupported' => {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return 'unsupported';
  try {
    return window.Notification.permission;
  } catch {
    return 'unsupported';
  }
};

export const browserNotificationsSupported = (): boolean =>
  !isNativeShell() && notificationPermission() !== 'unsupported';

/** Ask for browser notification permission. Safe to call repeatedly. */
export const requestTradingNotificationPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
  if (!browserNotificationsSupported()) return 'unsupported';
  try {
    if (window.Notification.permission === 'granted') return 'granted';
    if (window.Notification.permission === 'denied') return 'denied';
    return await window.Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
};

const showBrowserNotification = (content: TradingNotificationContent): void => {
  if (isNativeShell()) return;
  if (notificationPermission() !== 'granted') return;
  try {
    new window.Notification(content.title, {
      body: content.message,
      tag: `jfx-trade-${content.kind}`,
    });
  } catch {
    /* Notification constructor unavailable / blocked */
  }
};

const nativeLocalNotifications = (): any | null => {
  if (!isNativeShell()) return null;
  try {
    return (window as any).Capacitor?.Plugins?.LocalNotifications ?? null;
  } catch {
    return null;
  }
};

/** Stable 32-bit id so rescheduling the same rule replaces its notification. */
const nativeNotificationId = (seed: string): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2_147_483_000) + 1;
};

const showNativeNotification = (content: TradingNotificationContent, seed?: string): void => {
  const plugin = nativeLocalNotifications();
  if (!plugin?.schedule) return;
  void (async () => {
    try {
      if (typeof plugin.checkPermissions === 'function') {
        const permission = await plugin.checkPermissions();
        if (permission && permission.display !== 'granted') return;
      }
      await plugin.schedule({
        notifications: [
          {
            id: seed ? nativeNotificationId(seed) : (Date.now() % 2_147_483_000) + 1,
            title: content.title,
            body: content.message,
            schedule: { at: new Date(Date.now() + 100) },
          },
        ],
      });
    } catch {
      /* Native plugin unavailable or permission denied. */
    }
  })();
};

interface DeliverOptions {
  skipToast?: boolean;
  /** Use Capacitor LocalNotifications when running in the native shell. */
  useNative?: boolean;
  nativeSeed?: string;
}

const deliverNotification = (
  content: TradingNotificationContent,
  options: TradingNotifyOptions,
  deliver: DeliverOptions = {}
): void => {
  if (!deliver.skipToast && options.addToast) {
    options.addToast({
      type: content.toastType,
      title: content.title,
      message: content.message,
      duration: content.toastType === 'error' ? 6000 : 4000,
    });
  }

  if (options.browserNotifications !== false) {
    showBrowserNotification(content);
    if (deliver.useNative) showNativeNotification(content, deliver.nativeSeed);
  }
};

/**
 * Emit one trading notification. Returns the resolved content so callers
 * (and tests) can assert the mapping without inspecting browser state.
 */
export const notifyTradingEvent = (
  event: TradingEvent,
  options: TradingNotifyOptions = {}
): TradingNotificationContent => {
  const kind: TradingNotificationKind = event.kind === 'error'
    ? classifyTradingError(event.message, event.errorCode)
    : event.kind;
  const content = tradingNotificationContent(
    kind,
    'message' in event ? event.message : undefined,
    'title' in event ? event.title : undefined
  );

  deliverNotification(content, options, { skipToast: event.alreadyToasted });
  return content;
};

/** Emit the "Trade blocked by <rule>" toast/browser/native notification. */
export const notifyLockBlock = (
  input: LockBlockInput,
  options: TradingNotifyOptions = {}
): TradingNotificationContent => {
  const content = buildLockBlockContent(input);
  deliverNotification(content, options, {
    useNative: true,
    nativeSeed: `lock-block:${input.rule || 'lock'}:${Date.now()}`,
  });
  return content;
};

/**
 * Drops native LocalNotifications when a pending change is cancelled and
 * schedules one for each future effective time. Same per-portfolio/rule id
 * means a newer schedule replaces the previous one.
 */
export const syncNativeLockChangeNotifications = (
  portfolioId: string,
  locks: PortfolioLocks | null | undefined
): void => {
  const plugin = nativeLocalNotifications();
  if (!plugin || !portfolioId || !locks) return;

  for (const rule of LOCK_RULE_KEYS) {
    const id = nativeNotificationId(`lock-change:${portfolioId}:${rule}`);
    const pending = locks[rule]?.pendingChange;
    const requestedAt = pending?.requestedAt ? Date.parse(pending.requestedAt) : NaN;
    const effectiveAt = Number.isFinite(requestedAt) ? requestedAt + LOCK_UNLOCK_COOLDOWN_MS : NaN;

    if (pending && Number.isFinite(effectiveAt) && effectiveAt > Date.now() && !pendingChangeElapsed(pending)) {
      const description = pendingChangeDescription(rule, pending.value);
      void (async () => {
        try {
          await plugin.cancel?.({ notifications: [{ id }] });
          await plugin.schedule?.({
            notifications: [
              {
                id,
                title: 'Lock change now active',
                body: description,
                schedule: { at: new Date(effectiveAt), allowWhileIdle: true },
              },
            ],
          });
        } catch {
          /* Native plugin unavailable or permission denied. */
        }
      })();
    } else {
      void plugin.cancel?.({ notifications: [{ id }] }).catch?.(() => {});
    }
  }
};

/**
 * Applies elapsed pending lock changes and emits each one exactly once. The
 * dedupe key is portfolio+rule+pending timestamp in localStorage, so the
 * 60-second poll can call this repeatedly without duplicate alerts.
 */
export const notifyElapsedLockChanges = (
  portfolioId: string,
  addToast?: (toast: ToastLike) => void
): TradingNotificationContent[] => {
  const changes = applyElapsedLockChanges(portfolioId);
  const delivered: TradingNotificationContent[] = [];
  for (const change of changes) {
    if (hasNotifiedLockChange(change.dedupeKey)) continue;
    markLockChangeNotified(change.dedupeKey);
    const content = buildLockChangeContent(change.description);
    // Same id as the pre-scheduled native notification for this portfolio/rule,
    // so an immediate alert replaces the scheduled one instead of doubling it.
    const nativeSeed = `lock-change:${portfolioId}:${change.rule}`;
    deliverNotification(content, { addToast }, { useNative: true, nativeSeed });
    delivered.push(content);
  }
  return delivered;
};
