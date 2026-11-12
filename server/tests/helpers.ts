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
 * Clears every rate-limit bucket and account lockout, but leaves the response
 * cache alone.
 *
 * This is the one the Phase 8 suite wants. Those limits are real and tight —
 * register is 3/min per IP, login 5/min — and every test here registers at
 * least one user from 127.0.0.1, so a suite of 30 tests exhausts the bucket
 * within the first few. The limiter is not wrong; the test process is a very
 * noisy client that looks exactly like a scripted account-creation attack.
 *
 * Clearing per test (not once per file) keeps the suite honest: each test
 * starts with a full budget, and a test that deliberately trips a limit still
 * sees a real 429 because nothing clears the bucket mid-test.
 */
export async function resetRateLimits(): Promise<void> {
  const store = await getStore();
  // Both limiter families: `rl:` is the fixed window (catalog), `rlsw:` is the
  // sliding window (auth, cart, checkout). Missing the second one leaves the
  // auth suites rate-limited from a previous run.
  const buckets = await store.keys('rl:*');
  const sliding = await store.keys('rlsw:*');
  const lockouts = await store.keys('lockout:*');
  const all = [...buckets, ...sliding, ...lockouts];
  if (all.length > 0) await store.del(...all);
}

/**
 * Wipes the response cache and every rate-limit bucket.
 *
 * Without this, a suite that fires 100+ requests trips the limiter and every
 * later assertion fails with a 429 that has nothing to do with the code under
 * test.
 */
export async function resetState(): Promise<void> {
  await clearCache();
  await resetRateLimits();
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
