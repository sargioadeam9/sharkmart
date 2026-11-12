import { defineConfig } from 'vitest/config';

/**
 * Phase 6 test config.
 *
 * `singleThread` is deliberate: the rate limiter and the response cache both
 * fall back to a process-local store when Redis is absent, so parallel workers
 * would each get their own counter and the 429 test would be meaningless.
 * One process, one store, one honest limit.
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
    poolOptions: { threads: { singleThread: true } },
    sequence: { concurrent: false },
  },
});
