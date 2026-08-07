import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryCache } from '../lib/cacheService';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache(1000, 3); // 1s TTL, max 3 items
  });

  it('stores and retrieves values before TTL expiration', () => {
    cache.set('key1', { value: 42 });
    expect(cache.get('key1')).toEqual({ value: 42 });
  });

  it('expires entries after TTL', async () => {
    cache.set('key1', 'test_data', 50); // 50ms TTL
    expect(cache.get('key1')).toBe('test_data');

    await new Promise((r) => setTimeout(r, 60));
    expect(cache.get('key1')).toBeNull();
  });

  it('evicts oldest entry when maxEntries threshold is reached', () => {
    cache.set('k1', 1);
    cache.set('k2', 2);
    cache.set('k3', 3);
    expect(cache.size).toBe(3);

    cache.set('k4', 4); // Exceeds maxEntries (3) -> evicts 'k1'
    expect(cache.size).toBe(3);
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k4')).toBe(4);
  });

  it('handles getOrSet transparently', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 'ok' });

    const res1 = await cache.getOrSet('endpoint', fetchFn, 500);
    expect(res1).toEqual({ status: 'ok' });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second call should return cached data without calling fetchFn again
    const res2 = await cache.getOrSet('endpoint', fetchFn, 500);
    expect(res2).toEqual({ status: 'ok' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
