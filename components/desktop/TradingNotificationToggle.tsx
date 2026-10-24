import React, { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import {
  browserNotificationsSupported,
  requestTradingNotificationPermission,
} from '../../lib/tradingNotifications';

/**
 * Opt-in control for browser notifications. Permission requests must come
 * from a user gesture, so this stays a button rather than firing on mount.
 */
export const TradingNotificationToggle: React.FC = () => {
  const supported = browserNotificationsSupported();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (!supported) return 'unsupported';
    try {
      return window.Notification.permission;
    } catch {
      return 'unsupported';
    }
  });
  const [busy, setBusy] = useState(false);

  if (!supported) return null;

  if (permission === 'granted') {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 text-[11px] font-bold text-emerald-300">
        <Bell size={13} /> Alerts on
      </span>
    );
  }

  if (permission === 'denied') {
    return (
      <span
        title="Allow notifications for this site in your browser settings."
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[11px] font-semibold text-zinc-500"
      >
        <BellOff size={13} /> Alerts blocked
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const next = await requestTradingNotificationPermission();
        setPermission(next);
        setBusy(false);
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[11px] font-bold text-zinc-300 transition-colors hover:bg-white/[0.07] disabled:opacity-50"
    >
      <Bell size={13} /> {busy ? 'Requesting…' : 'Enable alerts'}
    </button>
  );
};
