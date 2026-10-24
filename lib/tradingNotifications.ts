/**
 * Trading event notifications shared by the desktop cTrader panels.
 *
 * Mobile (APK/web shell) keeps its existing toasts; this module adds the
 * desktop layer: in-app toasts plus the browser Notification API when the
 * user granted permission. It never imports Capacitor — the native globals
 * are only probed defensively — so loading it on web can never throw.
 */

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

  if (!event.alreadyToasted && options.addToast) {
    options.addToast({
      type: content.toastType,
      title: content.title,
      message: content.message,
      duration: content.toastType === 'error' ? 6000 : 4000,
    });
  }

  if (options.browserNotifications !== false) {
    showBrowserNotification(content);
  }

  return content;
};
