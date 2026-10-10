import { describe, expect, it } from 'vitest';

import { rateLimit } from '../api/_lib/rateLimit';

// NOTE: these tests run without SUPABASE_* env vars, so the shared RPC
// limiter is unreachable and the in-memory degraded guard must hold the line.
describe('rateLimit degraded guard', () => {
  it('allows up to the limit then denies with a retry hint', async () => {
    const key = `test-degraded-${Date.now()}-${Math.random()}`;
    const first = await rateLimit(key, 2, 60_000);
    const second = await rateLimit(key, 2, 60_000);
    const third = await rateLimit(key, 2, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it('reports invalid budgets as unavailable instead of failing open', async () => {
    const result = await rateLimit('test-invalid', 0, 60_000);
    expect(result).toMatchObject({ allowed: false, unavailable: true });
  });
});
