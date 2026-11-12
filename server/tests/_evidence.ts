/**
 * Phase 6 evidence: EXPLAIN plans + p95 latency.
 *
 * Run with: npx tsx tests/_evidence.ts
 * Output is pasted into HANDOFF.md. Not part of the test suite.
 */

import { prisma } from '../src/config/database.js';
import { getStore } from '../src/config/redis.js';
import { createApp } from '../src/app.js';
import request from 'supertest';

const app = createApp();

function line(label: string, value: unknown) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
  console.log(`${label}: ${text}`);
}

console.log('=== EXPLAIN: heaviest listing query (category + sort + page) ===');
const listPlan = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
  `EXPLAIN SELECT p.id, p.basePricePoisha
   FROM Product p
   WHERE p.isPublished = 1 AND p.isDraft = 0 AND p.categoryId = (SELECT id FROM Category WHERE slug = 'fashion' LIMIT 1)
   ORDER BY p.createdAt ASC
   LIMIT 20 OFFSET 0`,
);
for (const row of listPlan) line('  plan', row);

console.log('\n=== EXPLAIN: price-sorted listing ===');
const pricePlan = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
  `EXPLAIN SELECT p.id, p.basePricePoisha
   FROM Product p
   WHERE p.isPublished = 1 AND p.isDraft = 0
   ORDER BY p.basePricePoisha ASC
   LIMIT 50`,
);
for (const row of pricePlan) line('  plan', row);

console.log('\n=== EXPLAIN: flash-sale window ===');
const flashPlan = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
  `EXPLAIN SELECT p.id
   FROM Product p
   WHERE p.isPublished = 1 AND p.isDraft = 0
     AND p.isFlashSale = 1
     AND p.flashSaleStart <= NOW() AND p.flashSaleEnd > NOW()
   ORDER BY p.flashSaleEnd ASC
   LIMIT 50`,
);
for (const row of flashPlan) line('  plan', row);

console.log('\n=== EXPLAIN: warehouse stock groupBy ===');
const stockPlan = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
  `EXPLAIN SELECT productId, SUM(quantity) FROM WarehouseStock
   WHERE variantId IS NULL GROUP BY productId`,
);
for (const row of stockPlan) line('  plan', row);

async function resetLimiter() {
  const store = await getStore();
  const buckets = await store.keys('rl:*');
  if (buckets.length > 0) await store.del(...buckets);
}

async function percentile(path: string, runs: number) {
  await resetLimiter();
  // Warm the cache the way production would.
  await request(app).get(path);

  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    const res = await request(app).get(path);
    const end = process.hrtime.bigint();
    if (res.status !== 200) throw new Error(`${path} returned ${res.status}`);
    samples.push(Number(end - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const at = (p: number) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))]!;
  return {
    path,
    runs,
    p50: Number(at(50).toFixed(1)),
    p95: Number(at(95).toFixed(1)),
    p99: Number(at(99).toFixed(1)),
    max: Number(samples[samples.length - 1]!.toFixed(1)),
  };
}

console.log('\n=== LATENCY (warm cache, in-process) ===');
for (const path of [
  '/api/v1/products?limit=20',
  '/api/v1/products?category=fashion&sort=price_asc&limit=20',
  '/api/v1/homepage',
  '/api/v1/categories',
]) {
  line('  ' + path, await percentile(path, 60));
}

console.log('\n=== LATENCY (cold cache: first hit, cache cleared between) ===');
const { clearCache } = await import('../src/services/cache.js');
for (const path of ['/api/v1/products?limit=20', '/api/v1/homepage']) {
  await resetLimiter();
  const samples: number[] = [];
  for (let i = 0; i < 15; i += 1) {
    await clearCache();
    const start = process.hrtime.bigint();
    const res = await request(app).get(path);
    const end = process.hrtime.bigint();
    if (res.status !== 200) throw new Error(`${path} returned ${res.status}`);
    samples.push(Number(end - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const at = (p: number) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))]!;
  line('  ' + path, {
    runs: 15,
    p50: Number(at(50).toFixed(1)),
    p95: Number(at(95).toFixed(1)),
    max: Number(samples[samples.length - 1]!.toFixed(1)),
  });
}

await prisma.$disconnect();
process.exit(0);
