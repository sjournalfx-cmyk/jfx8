/**
 * Server-side persistence for rotated cTrader tokens.
 *
 * The APK split this out into its own module (`api/_lib/ctraderTokens.ts`) so
 * exchange/refresh/trade could import it without dragging in the whole
 * API-key surface. This repo already had an equivalent function living inside
 * `jfxApiKey.ts`, and that copy is strictly stronger: it accepts
 * `previousToken` so the write can assert it is not clobbering a newer row.
 *
 * So rather than keep a second, weaker implementation, this module re-exports
 * the canonical one. Same import path as the APK, single implementation, and
 * no chance of the two drifting apart on a load-bearing credential write.
 */
export { persistRotatedCtraderToken } from './jfxApiKey.js';