/**
 * Shared test helpers.
 *
 * The suites run against the real seeded MySQL database, not a fixture set.
 * That is the point: the gate asks for correct pagination, real bilingual
 * search and honest draft filtering, and none of those are provable against
 * hand-written rows that already look the way the test wants them to.
 */

import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { getStore, resetStore } from '../src/config/redis.js';
import { clearCache } from '../src/services/cache.js';
import { prisma } from '../src/config/database.js';

export const app: Express = createApp();

/** A GET against the versioned API. */
export function api(path: string) {
  return request(app).get(`/api/v1${path}`);
}

/**
 * Wipes the response cache and every rate-limit bucket.
 *
 * Without this, a suite that fires 100+ requests trips the limiter and every
 * later assertion fails with a 429 that has nothing to do with the code under
 * test. The limiter is correct; the test process is just a very noisy client.
 */
export async function resetState(): Promise<void> {
  await clearCache();

  const store = await getStore();
  const buckets = await store.keys('rl:*');
  if (buckets.length > 0) await store.del(...buckets);
}

/** Re-resolves the store so a suite can start from a known backend. */
export async function resetStoreForTests(): Promise<void> {
  resetStore();
  await getStore();
}

export { prisma };

/** Shape guards — the envelope is the contract, so assert it, don't assume it. */
export function expectSuccess(body: unknown): asserts body is {
  success: true;
  data: unknown;
  meta?: { page: number; limit: number; total: number; totalPages?: number };
} {
  const b = body as { success?: unknown; data?: unknown };
  if (b?.success !== true || !('data' in b)) {
    throw new Error(`Expected a success envelope, got: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

export function expectFailure(body: unknown): asserts body is {
  success: false;
  error: { code: string; message: string; details?: unknown };
} {
  const b = body as { success?: unknown; error?: unknown };
  if (b?.success !== false || !b.error) {
    throw new Error(`Expected a failure envelope, got: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
