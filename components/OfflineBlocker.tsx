import React, { useState, useEffect, useCallback } from 'react';
import { WifiOff, RefreshCw, AlertCircle } from 'lucide-react';
import { isNative } from '../lib/capacitor';

interface OfflineBlockerProps {
  onOnline?: () => void;
}

/**
 * Actively tests if the device has real internet access.
 */
export async function testInternetConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }

  try {
    if (isNative) {
      // In native Capacitor environment, direct native HTTP bypasses WebView restrictions.
      // The specifier is built at runtime so Rollup does not try to resolve
      // @capacitor/core: this repo has zero @capacitor dependencies and the
      // web bundle must stay free of native plugins (see lib/capacitor.ts).
      // `isNative` is hardcoded false here, so this branch never executes on web.
      const spec = ['@capacitor', 'core'].join('/');
      const mod: any = await import(/* @vite-ignore */ /* webpackIgnore: true */ spec);
      const CapacitorHttp = mod.CapacitorHttp;
      if (!CapacitorHttp) return typeof navigator !== 'undefined' ? navigator.onLine : true;
      const res = await CapacitorHttp.request({
        url: 'https://www.jfxjournal.site/favicon.ico?_t=' + Date.now(),
        method: 'GET',
        connectTimeout: 4000,
        readTimeout: 4000,
      });
      return res.status >= 200 && res.status < 400;
    } else {
      // In web browser, perform a lightweight cache-busted fetch
      const res = await fetch('https://www.jfxjournal.site/favicon.ico?_t=' + Date.now(), {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
      });
      return !!res;
    }
  } catch {
    // If the ping fails (e.g. CORS or DNS delay), default to navigator.onLine rather than falsely locking user out
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }
}

/**
 * Hook to track real-time network connectivity.
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      const hasNet = await testInternetConnectivity();
      setIsOnline(hasNet);
      return hasNet;
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = async () => {
      const active = await testInternetConnectivity();
      setIsOnline(active);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check if navigator reports offline immediately
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
    }

    // Auto-poll when offline to restore automatically as soon as data or Wi-Fi reconnects
    const interval = setInterval(() => {
      if (!isOnline) {
        testInternetConnectivity().then((online) => {
          if (online) setIsOnline(true);
        });
      }
    }, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [isOnline]);

  return { isOnline, isChecking, checkConnection };
}

export const OfflineBlocker: React.FC<OfflineBlockerProps & { isChecking?: boolean; onRetry?: () => void }> = ({
  onOnline,
  isChecking: externalChecking,
  onRetry: externalRetry,
}) => {
  const [internalChecking, setInternalChecking] = useState(false);
  const [checkFailedNotice, setCheckFailedNotice] = useState(false);

  const isChecking = externalChecking ?? internalChecking;

  const handleRetry = async () => {
    if (externalRetry) {
      externalRetry();
      return;
    }
    setInternalChecking(true);
    setCheckFailedNotice(false);
    try {
      const online = await testInternetConnectivity();
      if (online) {
        onOnline?.();
      } else {
        setCheckFailedNotice(true);
      }
    } finally {
      setInternalChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-[#09090b] px-6 text-center select-none">
      {/* Background glow */}
      <div className="absolute top-1/3 -translate-y-1/2 w-72 h-72 rounded-full bg-rose-600/10 blur-[90px] pointer-events-none" />

      <div className="relative max-w-sm w-full rounded-3xl border border-zinc-800/80 bg-zinc-900/90 p-8 shadow-2xl backdrop-blur-2xl">
        {/* Offline Badge Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 shadow-inner">
          <WifiOff className="h-10 w-10 text-rose-400" />
        </div>

        {/* Status Tag */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-400 uppercase tracking-wider mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
          Offline Mode Disabled
        </div>

        {/* Header */}
        <h2 className="text-xl font-bold tracking-tight text-white mb-2">
          Internet Connection Required
        </h2>

        {/* Description */}
        <p className="text-xs leading-relaxed text-zinc-400 mb-6">
          JFX Journal requires an active internet connection to synchronize trades, verify credentials, and secure your account data.
        </p>

        {checkFailedNotice && (
          <div className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Still offline. Check your Wi-Fi or mobile data.</span>
          </div>
        )}

        {/* Reconnect Action Button */}
        <button
          onClick={handleRetry}
          disabled={isChecking}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-600/20 hover:bg-orange-500 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
          {isChecking ? 'Testing Connection...' : 'Check Connection'}
        </button>

        <p className="mt-4 text-[11px] text-zinc-400">
          Will automatically reconnect when internet becomes available
        </p>
      </div>
    </div>
  );
};
