/**
 * CORS origin allowlist shared by the serverless API routes.
 *
 * Replaces the previous `Access-Control-Allow-Origin: *` on every endpoint:
 * the header is now only echoed back for known-good origins (the production
 * site and local dev servers), so an arbitrary website cannot read responses
 * cross-origin. Requests without an Origin header (curl, native clients, the
 * EA bridge) are unaffected — CORS is a browser-only mechanism.
 */

const ALLOWED_ORIGINS = new Set([
  'https://jfxjournal.site',
  'https://www.jfxjournal.site',
  // Capacitor native shells (Android uses https://localhost with androidScheme=https)
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]);

type HeaderMap = Record<string, string | string[] | undefined>;

export function resolveAllowedOrigin(headers: HeaderMap): string | undefined {
  const raw = headers['origin'] ?? headers['Origin'];
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (!origin) return undefined;
  return ALLOWED_ORIGINS.has(origin) ? origin : undefined;
}

/** Sets Access-Control-Allow-Origin (only for allowlisted origins) + Vary: Origin. */
export function applyCorsHeaders(
  res: { setHeader: (name: string, value: string) => void },
  headers: HeaderMap,
): void {
  const origin = resolveAllowedOrigin(headers);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}
