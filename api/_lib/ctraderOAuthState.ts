import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Native OAuth state must be unguessable AND server-verifiable. The legacy
 * fixed `jfx-native` value let anyone replay an authorization code into the
 * deep link. This module issues a short-lived HMAC-signed, user-bound state
 * that survives the trip through cTrader ID and the callback redirect.
 */

const STATE_PREFIX = 'jfxn1';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface NativeOAuthStatePayload {
  v: 1;
  uid: string;
  n: 1;
  iat: number;
  exp: number;
  nonce: string;
}

function stateSecret(): string {
  const secret = (process.env.CTRADER_OAUTH_STATE_SECRET || process.env.CTRADER_CLIENT_SECRET || '').trim();
  if (!secret) throw new Error('ctrader_oauth_state_secret_not_configured');
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createNativeOAuthState(userId: string, ttlMs: number = DEFAULT_TTL_MS, now: number = Date.now()): string {
  if (!userId) throw new Error('ctrader_oauth_state_requires_user');
  const payload: NativeOAuthStatePayload = {
    v: 1,
    uid: String(userId),
    n: 1,
    iat: now,
    exp: now + Math.max(60_000, ttlMs),
    nonce: randomBytes(16).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${STATE_PREFIX}.${encoded}.${sign(encoded, stateSecret())}`;
}

export function verifyNativeOAuthState(
  state: string | null | undefined,
  expectedUserId?: string | null,
  now: number = Date.now(),
): NativeOAuthStatePayload | null {
  if (!state) return null;
  const parts = String(state).split('.');
  if (parts.length !== 3 || parts[0] !== STATE_PREFIX) return null;
  const [, encoded, signature] = parts;
  if (!encoded || !signature) return null;

  let expected: string;
  try {
    expected = sign(encoded, stateSecret());
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: NativeOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || payload.v !== 1 || payload.n !== 1 || typeof payload.uid !== 'string') return null;
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
  if (now > payload.exp || now < payload.iat - 60_000) return null;
  if (expectedUserId && payload.uid !== String(expectedUserId)) return null;
  return payload;
}

export function isNativeOAuthState(state: string | null | undefined): boolean {
  return typeof state === 'string' && state.startsWith(`${STATE_PREFIX}.`);
}
