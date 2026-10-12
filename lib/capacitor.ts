/**
 * Web-only counterpart of the native Capacitor helper.
 * Same export surface, web behavior: the app is served from the same origin
 * as the API, so relative paths work and no native shell exists.
 * (Ported surface from jfx-mobile/lib/capacitor.ts; do not add @capacitor
 * imports here — the web bundle must stay dependency-free of native plugins.)
 */

export const isNative = false;
export const isAndroid = false;

/**
 * Base URL for the hosted JFX API (Vercel serverless routes).
 * On web the app is served from the same origin so relative paths work.
 */
export const apiBaseUrl: string = '';

/** Prefix a same-origin API path with the hosted base when running natively. */
export const apiUrl = (path: string): string => `${apiBaseUrl}${path}`;

/**
 * Open an OAuth/authorization URL. Natively this uses a Custom Tab;
 * on web it performs a normal navigation.
 */
export const openExternalUrl = async (url: string): Promise<void> => {
  window.location.href = url;
};

export const initCapacitor = async () => {
  // No-op on web — there is no native shell to initialise.
};
