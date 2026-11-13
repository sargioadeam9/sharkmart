import { defineConfig } from 'vitest/config';

/**
 * Phase 6 test config.
 *
 * `fileParallelism: false` is deliberate, for two independent reasons:
 *
 * 1. The rate limiter and the response cache both fall back to a process-local
 *    store when Redis is absent, so parallel workers would each get their own
 *    counter and the 429 test would be meaningless. One process, one store,
 *    one honest limit.
 * 2. Every suite shares one MySQL database. Parallel files race on shared rows:
 *    a fixture product created by one file changes the global product count
 *    another file asserts, and a stock adjustment in one file lands between the
 *    two reads of a before/after assertion in another. That produced a suite
 *    that failed a different test on every run while passing 201/201 serially.
 *
 * `poolOptions.threads.singleThread` was the old spelling of this and is a
 * silent no-op in Vitest 4+ — it is still accepted by the type, so it fails
 * quietly rather than erroring. `fileParallelism` is the option that works.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Integration tests talk to MySQL; give them room on a cold pool.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'threads',
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
