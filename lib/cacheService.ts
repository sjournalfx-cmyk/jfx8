interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTtlMs: number;
  private maxEntries: number;

  constructor(defaultTtlMs = 6000, maxEntries = 500) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    // LRU eviction if cache size exceeds maxEntries
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { data, expiresAt });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const freshData = await fetchFn();
    if (freshData !== null && freshData !== undefined) {
      if (typeof freshData === 'object' && freshData !== null && 'error' in freshData && (freshData as any).error) {
        return freshData;
      }
      this.set(key, freshData, ttlMs);
    }
    return freshData;
  }

  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.cache.size;
  }
}

export const appCache = new MemoryCache();
export { MemoryCache };
