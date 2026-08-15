/**
 * Minimal in-memory sliding-window rate limiter for the paid API proxies
 * (/api/nvidia, /api/modal-research, /api/transcribe).
 *
 * NOTE: Vercel serverless functions are ephemeral, so this state is per
 * warm instance — it bounds abuse (a single user hammering one instance)
 * but is not a hard global limit. For a strict multi-instance limit,
 * swap the store for Redis/Upstash later; the interface stays the same.
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 10_000;

function prune(): void {
  if (buckets.size < MAX_BUCKETS) return;
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < 60_000);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  prune();

  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0];
    return { allowed: false, retryAfterMs: windowMs - (now - oldest) };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { allowed: true };
}
