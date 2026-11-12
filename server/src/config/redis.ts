/**
 * Redis client — with an in-memory fallback.
 *
 * Redis powers the response cache and the rate limiter. Neither is allowed to
 * be a hard dependency of a public read endpoint: if Redis is down, the API
 * must still serve the catalog, just without caching and without cross-process
 * limit sharing. A cache outage is a performance event, not an outage.
 *
 * So: try to connect once at boot. If the connection fails, fall back to a
 * process-local store that implements the same tiny surface the cache and
 * limiter actually use (`get`, `set` with TTL, `del`, `incr` with TTL, `keys`).
 * That keeps one code path in the callers and makes the API runnable on a
 * machine with no Redis installed — which is exactly this one.
 *
 * The fallback is per-process. With more than one API instance it under-counts
 * rate limits and under-shares cache. That is a documented, acceptable
 * degradation for a single-instance deployment; production runs real Redis.
 */

import Redis from 'ioredis';
import { env } from './env.js';

/** The subset of Redis the cache and limiter use. Both backends implement it. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` <= 0 means "no expiry". */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Atomic increment; sets the TTL when the key is created. Returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Prefix scan — used only by tag invalidation, never on a hot path. */
  keys(pattern: string): Promise<string[]>;
  readonly kind: 'redis' | 'memory';
}

/** In-process fallback. Bounded so a long-running process cannot leak. */
class MemoryStore implements KeyValueStore {
  readonly kind = 'memory' as const;

  private readonly data = new Map<string, { value: string; expiresAt: number }>();

  /** Hard cap on tracked keys — the cache is best-effort, so eviction is fine. */
  private static readonly MAX_KEYS = 5000;

  private live(key: string): string | null {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  private evictIfNeeded(): void {
    if (this.data.size <= MemoryStore.MAX_KEYS) return;
    // Map preserves insertion order, so the oldest key is the first one.
    const oldest = this.data.keys().next();
    if (!oldest.done) this.data.delete(oldest.value);
  }

  async get(key: string): Promise<string | null> {
    return this.live(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.evictIfNeeded();
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
    });
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = this.live(key);
    const next = current === null ? 1 : Number(current) + 1;

    const existing = this.data.get(key);
    this.data.set(key, {
      value: String(next),
      // Keep the original expiry; only a brand-new key gets a fresh TTL.
      expiresAt: existing?.expiresAt ?? (ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0),
    });

    return next;
  }

  async keys(pattern: string): Promise<string[]> {
    // Only `prefix*` patterns are ever used, so a startsWith filter is exact.
    const prefix = pattern.replace(/\*$/, '');
    const out: string[] = [];
    for (const key of [...this.data.keys()]) {
      if (this.live(key) !== null && key.startsWith(prefix)) out.push(key);
    }
    return out;
  }
}

/** Thin adapter so ioredis satisfies `KeyValueStore` without leaking its types. */
class RedisStore implements KeyValueStore {
  readonly kind = 'redis' as const;

  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.client.incr(key);
    // EXPIRE only on the first increment, so the window does not slide.
    if (value === 1 && ttlSeconds > 0) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async keys(pattern: string): Promise<string[]> {
    // SCAN, not KEYS — KEYS blocks the server for the whole keyspace.
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }
}

let store: KeyValueStore | null = null;

/**
 * Resolves the store once, at first use.
 *
 * A failed Redis connection is logged once and downgrades the whole process to
 * the memory store; it never throws into a request.
 */
export async function getStore(): Promise<KeyValueStore> {
  if (store) return store;

  if (!env.REDIS_URL) {
    store = new MemoryStore();
    return store;
  }

  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // Fail fast at boot rather than queueing commands against a dead server.
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    await client.ping();
    store = new RedisStore(client);
  } catch {
    client.disconnect();
     
    console.warn(
      `[cache] Redis unavailable at ${env.REDIS_URL} — using the in-process store. ` +
        'Caching and rate limits are per-process until Redis is up.',
    );
    store = new MemoryStore();
  }

  return store;
}

/** Test hook — drops the memoised store so a suite can re-resolve it. */
export function resetStore(): void {
  store = null;
}

/** Closes the Redis connection on shutdown. No-op for the memory store. */
export async function closeStore(): Promise<void> {
  if (store?.kind === 'redis') {
    // The adapter holds the client privately; disconnect via the global map.
    const client = (store as unknown as { client?: Redis }).client;
    client?.disconnect();
  }
  store = null;
}
