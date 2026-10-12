/**
 * Feature flags for mobile vs desktop.
 * Keep logic in one place so App.tsx stays clean.
 */

// Read VITE_MOBILE_ENABLED from env: default true so mobile web + APK show real app.
// Set VITE_MOBILE_ENABLED=false to bring back the hard blocker on web (for testing).
export const MOBILE_ENABLED: boolean =
  (import.meta as any)?.env?.VITE_MOBILE_ENABLED !== 'false';

// Capacitor native check — true when running inside Android WebView (APK)
export const IS_CAPACITOR: boolean = (() => {
  try {
    const w = window as any;
    return !!(w?.Capacitor?.isNativePlatform?.() || w?.Capacitor?.platform === 'android');
  } catch {
    return false;
  }
})();

export const IS_ANDROID_APK: boolean = IS_CAPACITOR;
