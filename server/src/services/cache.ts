/**
 * Response cache with tag-based invalidation.
 *
 * TTLs come from backend.md § "Cost Optimization Rules":
 *   homepage 5 min · categories 10 min · product lists 2 min
 *
 * Tags exist so a future admin write can invalidate "everything that mentions
 * products" without knowing every cache key. A key registers itself under each
 * of its tags; invalidating a tag deletes the registered keys. Reads never
 * touch the tag sets, so the hot path stays one GET plus one SET.
 *
 * Failure policy: every cache operation is best-effort. A cache that throws
 * must never fail the request it was supposed to accelerate — the caller gets
 * a miss and the database answers.
 */

import { getStore } from '../config/redis.js';

export const TTL = {
  /** The homepage aggregate: expensive, changes slowly. */
  homepage: 300,
  /** Category tree and category detail. */
  categories: 600,
  /** Product lists and search. */
  products: 120,
  /** A single product detail. */
  product: 120,
  /** Flash sale — short, because the window can end mid-cache. */
  flashSale: 60,
  /** Landing pages. */
  landing: 300,
  /**
   * The store settings map. Short enough that a missed invalidation corrects
   * itself, long enough that checkout does not query per order.
   */
  settings: 300,
} as const;

export type CacheTag = 'products' | 'categories' | 'brands' | 'homepage' | 'flash-sale' | 'settings';

const keyPrefix = 'cache:';
const tagPrefix = 'tag:';

/** Reads a cached value. Returns null on a miss, a corrupt value, or any error. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const store = await getStore();
    const raw = await store.get(keyPrefix + key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Writes a value under a key and registers the key under each tag. */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
  tags: readonly CacheTag[] = [],
): Promise<void> {
  try {
    const store = await getStore();
    await store.set(keyPrefix + key, JSON.stringify(value), ttlSeconds);

    // Tag sets outlive the entries they point at, so they get a generous TTL.
    // A stale tag member is harmless: deleting a missing key is a no-op.
    for (const tag of tags) {
      await store.set(`${tagPrefix}${tag}:${key}`, '1', ttlSeconds + 60);
    }
  } catch {
    // Best-effort. A cache write failure is not a request failure.
  }
}

/**
 * Cache-aside helper: return the cached value, or run `load`, cache it, return.
 *
 * The single place the read-through pattern lives, so no route re-implements
 * it (and no route forgets the tag registration).
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  tags: readonly CacheTag[],
  load: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const value = await load();
  await cacheSet(key, value, ttlSeconds, tags);
  return value;
}

/**
 * Deletes every key registered under a tag.
 *
 * Called by admin writes (Phase 9). Not on any read path.
 */
export async function invalidateTag(tag: CacheTag): Promise<number> {
  try {
    const store = await getStore();
    const members = await store.keys(`${tagPrefix}${tag}:*`);
    if (members.length === 0) return 0;

    const cacheKeys = members.map((m) => keyPrefix + m.slice(`${tagPrefix}${tag}:`.length));
    await store.del(...cacheKeys, ...members);
    return cacheKeys.length;
  } catch {
    return 0;
  }
}

/**
 * Test/ops hook — wipes the whole response cache.
 *
 * Tag registrations are deleted too. They are not entries themselves, but
 * leaving them behind makes a later `invalidateTag` report keys that no longer
 * exist, and a "wiped" cache that still answers `invalidateTag` with a count of
 * ghosts is a cache nobody can reason about.
 */
export async function clearCache(): Promise<void> {
  try {
    const store = await getStore();
    const keys = await store.keys(`${keyPrefix}*`);
    if (keys.length > 0) await store.del(...keys);

    const tags = await store.keys(`${tagPrefix}*`);
    if (tags.length > 0) await store.del(...tags);
  } catch {
    // ignore
  }
}
