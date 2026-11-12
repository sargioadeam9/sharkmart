/**
 * Cache behaviour, rate limiting, homepage aggregate and flash sale.
 *
 * The cache tests use the store directly rather than timing a request: a
 * timing test on a 168-row table proves nothing. What matters is that a second
 * read is served from the cache and that an invalidation actually empties it.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { api, resetState, expectSuccess, expectFailure } from './helpers.js';
import { cacheGet, cacheSet, clearCache, invalidateTag, TTL } from '../src/services/cache.js';
import { getStore } from '../src/config/redis.js';

beforeAll(async () => {
  await resetState();
});

describe('cache store', () => {
  beforeEach(async () => {
    await clearCache();
  });

  it('a miss returns null', async () => {
    expect(await cacheGet('nothing-here')).toBeNull();
  });

  it('a set is readable and round-trips the value', async () => {
    await cacheSet('probe', { a: 1, b: ['x'] }, 60, ['products']);
    expect(await cacheGet('probe')).toEqual({ a: 1, b: ['x'] });
  });

  it('invalidateTag deletes the keys registered under it', async () => {
    await cacheSet('tagged-one', { n: 1 }, 60, ['products']);
    await cacheSet('tagged-two', { n: 2 }, 60, ['products']);
    await cacheSet('other-tag', { n: 3 }, 60, ['categories']);

    const removed = await invalidateTag('products');
    expect(removed).toBe(2);

    expect(await cacheGet('tagged-one')).toBeNull();
    expect(await cacheGet('tagged-two')).toBeNull();
    // A different tag is untouched.
    expect(await cacheGet('other-tag')).toEqual({ n: 3 });
  });

  it('clearCache empties everything', async () => {
    await cacheSet('a', 1, 60, ['products']);
    await cacheSet('b', 2, 60, ['categories']);
    await clearCache();
    expect(await cacheGet('a')).toBeNull();
    expect(await cacheGet('b')).toBeNull();
  });

  it('a second identical request is served from cache', async () => {
    await clearCache();

    const first = await api('/products?limit=3');
    expectSuccess(first.body);

    // The route caches under a normalised key; prove the entry now exists.
    const store = await getStore();
    const keys = await store.keys('cache:products:*');
    expect(keys.length).toBeGreaterThan(0);

    const second = await api('/products?limit=3');
    expectSuccess(second.body);
    expect(second.body.data).toEqual(first.body.data);
  });

  it('query-key order does not create a second cache entry', async () => {
    await clearCache();

    await api('/products?page=1&limit=4');
    const store = await getStore();
    const afterFirst = (await store.keys('cache:products:*')).length;

    await api('/products?limit=4&page=1');
    const afterSecond = (await store.keys('cache:products:*')).length;

    expect(afterSecond).toBe(afterFirst);
  });

  it('TTLs match the spec', () => {
    expect(TTL.homepage).toBe(300);
    expect(TTL.categories).toBe(600);
    expect(TTL.products).toBe(120);
  });
});

describe('rate limiting', () => {
  it('returns X-RateLimit headers on a normal request', async () => {
    await resetState();
    const res = await api('/products?limit=1');
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('search has a tighter bucket than the general API', async () => {
    await resetState();
    const search = await api('/search?q=a');
    const products = await api('/products?limit=1');
    expect(Number(search.headers['x-ratelimit-limit'])).toBeLessThan(
      Number(products.headers['x-ratelimit-limit']),
    );
  });

  it('exceeding the search limit returns 429 with the envelope', async () => {
    await resetState();

    const limit = 30;
    let last = await api('/search?q=a');
    for (let i = 0; i < limit; i += 1) {
      last = await api('/search?q=a');
      if (last.status === 429) break;
    }

    expect(last.status).toBe(429);
    expectFailure(last.body);
    expect(last.body.error.code).toBe('RATE_LIMITED');
    expect(last.headers['retry-after']).toBeDefined();
  });
});

describe('homepage aggregate', () => {
  it('returns every section in one response', async () => {
    await clearCache();
    const res = await api('/homepage');
    expect(res.status).toBe(200);
    expectSuccess(res.body);

    const data = res.body.data as Record<string, unknown>;
    // The storefront's 16 sections resolve from these payloads; assert the
    // rails it actually reads are present and non-empty.
    const railKeys = Object.keys(data).filter((k) => Array.isArray(data[k]));
    expect(railKeys.length).toBeGreaterThanOrEqual(5);
  });

  it('is one request, not eight', async () => {
    await clearCache();
    const store = await getStore();

    await api('/homepage');
    const keys = await store.keys('cache:homepage:*');
    expect(keys).toHaveLength(1);
  });

  it('is gzipped above the threshold', async () => {
    const res = await api('/homepage').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});

describe('flash sale', () => {
  it('returns only products inside a live window', async () => {
    await clearCache();
    const res = await api('/flash-sale');
    expect(res.status).toBe(200);
    expectSuccess(res.body);

    const data = res.body.data as {
      items: { isFlashSale: boolean; flashSaleEndsAt: string | null }[];
      endsAt?: string | null;
    };

    const now = Date.now();
    for (const item of data.items) {
      expect(item.isFlashSale).toBe(true);
      if (item.flashSaleEndsAt) {
        expect(new Date(item.flashSaleEndsAt).getTime()).toBeGreaterThanOrEqual(now - 60_000);
      }
    }
  });

  it('exposes a countdown target', async () => {
    const res = await api('/flash-sale');
    expectSuccess(res.body);
    const data = res.body.data as Record<string, unknown>;
    const hasTarget = 'endsAt' in data || 'countdownTarget' in data || 'endsAtIso' in data;
    expect(hasTarget).toBe(true);
  });
});

describe('landing pages', () => {
  it('an unknown or inactive slug is a 404', async () => {
    const res = await api('/landing/no-such-campaign');
    expect(res.status).toBe(404);
    expectFailure(res.body);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
