import { useEffect, useRef } from 'react';
import { useToast } from '../components/ui/Toast';
import { notifyElapsedLockChanges } from '../lib/tradingNotifications';

const CHECK_INTERVAL_MS = 60_000;

/**
 * Watches every portfolio's local trading-lock cache while the app is open.
 * A pending 24h loosening is applied when it elapses and announced once (the
 * dedupe key lives in localStorage), so the timer can run cheaply every minute
 * without spamming the user. Also checks immediately on mount and whenever the
 * tab becomes visible again.
 */
export const useLockChangeNotifications = (portfolioIds: readonly string[] | null | undefined, enabled = true): void => {
  const { addToast } = useToast();
  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  const idsKey = (portfolioIds || []).join('|');

  useEffect(() => {
    if (!enabled) return undefined;
    const ids = idsKey ? idsKey.split('|') : [];

    const check = () => {
      for (const id of ids) {
        if (!id) continue;
        notifyElapsedLockChanges(id, addToastRef.current);
      }
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [idsKey, enabled]);
};
