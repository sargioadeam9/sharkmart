#!/usr/bin/env node
/**
 * Parity check — does the live API actually match the frontend DTOs?
 *
 * The flip from mock to real API is only safe if every field the components
 * read exists on the wire with the right type. One mismatch found by reading
 * means others exist, so this asserts every required key on all five surfaces
 * the storefront consumes and exits non-zero on any mismatch.
 *
 * Run with the API up:  node tools/parity-check.mjs
 *
 * It reads INTERNAL_API_TOKEN from server/.env when present so the check itself
 * is not rate limited. The token is never printed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const PREFIX = '/api/v1';

/** Reads the internal token without ever echoing it. */
function internalToken() {
  if (process.env.INTERNAL_API_TOKEN) return process.env.INTERNAL_API_TOKEN;
  try {
    const env = readFileSync(join(root, 'server', '.env'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => l.startsWith('INTERNAL_API_TOKEN='));
    const value = line?.slice('INTERNAL_API_TOKEN='.length).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

const TOKEN = internalToken();

const failures = [];
let checks = 0;

function fail(path, message, value) {
  failures.push({ path, message, value });
}

/** Asserts a value is present and of the expected primitive type. */
function expectType(obj, key, type, base) {
  checks += 1;
  const path = base ? `${base}.${key}` : key;
  if (!(key in obj)) {
    fail(path, `missing (expected ${type})`);
    return;
  }
  const v = obj[key];
  if (type === 'array') {
    if (!Array.isArray(v)) fail(path, `expected array, got ${typeof v}`, v);
    return;
  }
  if (type === 'null-or-string') {
    if (v !== null && typeof v !== 'string') fail(path, `expected string|null, got ${typeof v}`, v);
    return;
  }
  if (type === 'null-or-number') {
    if (v !== null && typeof v !== 'number') fail(path, `expected number|null, got ${typeof v}`, v);
    return;
  }
  if (type === 'null-or-object') {
    if (v !== null && (typeof v !== 'object' || Array.isArray(v)))
      fail(path, `expected object|null, got ${Array.isArray(v) ? 'array' : typeof v}`, v);
    return;
  }
  if (typeof v !== type) fail(path, `expected ${type}, got ${v === null ? 'null' : typeof v}`, v);
}

/** Asserts an integer (money must never be a float on the wire). */
function expectInt(obj, key, base) {
  checks += 1;
  const path = base ? `${base}.${key}` : key;
  if (!(key in obj)) return fail(path, 'missing (expected integer)');
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v))
    fail(path, `expected integer, got ${typeof v} ${v}`, v);
}

/** Asserts a member of a union. */
function expectEnum(obj, key, allowed, base) {
  checks += 1;
  const path = base ? `${base}.${key}` : key;
  if (!(key in obj)) return fail(path, `missing (expected one of ${allowed.join('|')})`);
  if (!allowed.includes(obj[key]))
    fail(path, `expected one of ${allowed.join('|')}, got ${JSON.stringify(obj[key])}`, obj[key]);
}

async function get(path) {
  const res = await fetch(`${BASE}${PREFIX}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(TOKEN ? { 'X-Internal-Token': TOKEN } : {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ─── DTO assertions ──────────────────────────────────────────────────────────

function checkProduct(p, base) {
  expectType(p, 'id', 'string', base);
  expectType(p, 'slug', 'string', base);
  expectType(p, 'sku', 'string', base);
  expectType(p, 'nameEn', 'string', base);
  expectType(p, 'nameBn', 'string', base);
  expectType(p, 'descriptionEn', 'null-or-string', base);
  expectType(p, 'descriptionBn', 'null-or-string', base);
  expectType(p, 'category', 'object', base);
  expectType(p, 'brand', 'null-or-object', base);
  expectInt(p, 'pricePoisha', base);
  expectInt(p, 'originalPricePoisha', base);
  expectInt(p, 'discountPercent', base);
  expectType(p, 'images', 'array', base);
  expectType(p, 'variants', 'array', base);
  expectType(p, 'rating', 'number', base);
  expectInt(p, 'reviewCount', base);
  expectEnum(p, 'stockStatus', ['in_stock', 'low_stock', 'out_of_stock'], base);
  expectInt(p, 'stockQuantity', base);
  expectType(p, 'isFeatured', 'boolean', base);
  expectType(p, 'isFlashSale', 'boolean', base);
  expectType(p, 'flashSalePricePoisha', 'null-or-number', base);
  expectType(p, 'flashSaleEndsAt', 'null-or-string', base);
  expectType(p, 'badges', 'array', base);
  expectType(p, 'createdAt', 'string', base);
  expectType(p, 'updatedAt', 'string', base);

  if (p.category && typeof p.category === 'object') {
    expectType(p.category, 'id', 'string', `${base}.category`);
    expectType(p.category, 'slug', 'string', `${base}.category`);
    expectType(p.category, 'nameEn', 'string', `${base}.category`);
    expectType(p.category, 'nameBn', 'string', `${base}.category`);
  }
  if (p.brand && typeof p.brand === 'object') {
    expectType(p.brand, 'id', 'string', `${base}.brand`);
    expectType(p.brand, 'slug', 'string', `${base}.brand`);
    expectType(p.brand, 'nameEn', 'string', `${base}.brand`);
    expectType(p.brand, 'nameBn', 'string', `${base}.brand`);
    expectType(p.brand, 'color', 'null-or-string', `${base}.brand`);
  }
}

function checkCategory(c, base) {
  expectType(c, 'id', 'string', base);
  expectType(c, 'slug', 'string', base);
  expectType(c, 'nameEn', 'string', base);
  expectType(c, 'nameBn', 'string', base);
  expectType(c, 'accentColor', 'string', base);
  expectType(c, 'lightTintColor', 'string', base);
  expectType(c, 'iconEmoji', 'string', base);
  expectInt(c, 'sortOrder', base);
  expectInt(c, 'productCount', base);
  expectType(c, 'subcategories', 'array', base);
}

function checkBrand(b, base) {
  expectType(b, 'id', 'string', base);
  expectType(b, 'slug', 'string', base);
  expectType(b, 'nameEn', 'string', base);
  expectType(b, 'nameBn', 'string', base);
  expectType(b, 'logo', 'null-or-string', base);
  expectType(b, 'taglineEn', 'null-or-string', base);
  expectType(b, 'taglineBn', 'null-or-string', base);
  expectType(b, 'color', 'null-or-string', base);
  expectType(b, 'isOwnBrand', 'boolean', base);
  expectInt(b, 'sortOrder', base);
  expectInt(b, 'productCount', base);
}

/**
 * The flat ProductDetailDto the frontend consumes.
 *
 * The server returns a NESTED shape ({ product, categoryColors, specifications,
 * details, reviews, relatedIds }). This check asserts the flat contract because
 * that is what the components read; the mapper in src/lib/api/ is responsible
 * for flattening, and this script is what proves the mapper can.
 */
function checkProductDetail(d, base) {
  checkProduct(d, base);
  expectType(d, 'variantGroups', 'array', base);
  expectType(d, 'reviews', 'array', base);
  expectType(d, 'ratingBreakdown', 'array', base);
  expectType(d, 'featuresEn', 'array', base);
  expectType(d, 'featuresBn', 'array', base);
  expectType(d, 'specs', 'array', base);
  expectType(d, 'tintColor', 'string', base);
  expectType(d, 'accentColor', 'string', base);
}

// ─── Surfaces ────────────────────────────────────────────────────────────────

async function surfaceHomepage() {
  const { status, body } = await get('/homepage');
  if (status !== 200) return fail('/homepage', `HTTP ${status}`);
  if (!body?.success) return fail('/homepage', 'envelope: success !== true');

  const d = body.data;
  const rails = [
    'flashSale',
    'featured',
    'newArrivals',
    'bestSellers',
    'trending',
    'onlyForYou',
    'recommended',
    'popular',
    'catalog',
  ];
  for (const rail of rails) {
    expectType(d, rail, 'array', 'data');
    if (Array.isArray(d[rail]) && d[rail].length > 0) {
      checkProduct(d[rail][0], `data.${rail}[0]`);
    }
  }
  expectType(d, 'categories', 'array', 'data');
  if (d.categories?.length) checkCategory(d.categories[0], 'data.categories[0]');
  expectType(d, 'ownBrands', 'array', 'data');
  if (d.ownBrands?.length) checkBrand(d.ownBrands[0], 'data.ownBrands[0]');
  expectType(d, 'externalBrands', 'array', 'data');
  expectType(d, 'promos', 'array', 'data');
  expectType(d, 'flashSaleEndsAt', 'string', 'data');
  expectInt(d, 'freeDeliveryThresholdPoisha', 'data');
}

async function surfaceCategory() {
  const slug = 'fashion';
  const { status, body } = await get(`/categories/${slug}`);
  if (status !== 200) return fail(`/categories/${slug}`, `HTTP ${status}`);
  if (!body?.success) return fail(`/categories/${slug}`, 'envelope: success !== true');

  /**
   * The server's shape is `{ category, products }`. That is deliberate — the
   * category page needs both and one round trip beats two. `getCategory()` in
   * src/lib/api/categories.ts unwraps it to the bare CategoryDto the components
   * read, so this asserts the server side of that contract.
   */
  const d = body.data;
  expectType(d, 'category', 'object', 'data');
  expectType(d, 'products', 'array', 'data');
  if (d.category) checkCategory(d.category, 'data.category');
  if (d.products?.length) checkProduct(d.products[0], 'data.products[0]');

  checks += 1;
  if (!Array.isArray(d.products) || d.products.length === 0) {
    fail('data.products', 'empty — the category page would render no grid');
  }
}

async function surfaceProducts() {
  const { status, body } = await get('/products?limit=3');
  if (status !== 200) return fail('/products', `HTTP ${status}`);
  if (!body?.success) return fail('/products', 'envelope: success !== true');
  if (!Array.isArray(body.data)) return fail('/products', 'data is not an array');

  for (let i = 0; i < body.data.length; i += 1) {
    checkProduct(body.data[i], `data[${i}]`);
  }

  checks += 1;
  if (!body.meta) fail('meta', 'missing pagination meta');
  else {
    expectInt(body.meta, 'page', 'meta');
    expectInt(body.meta, 'limit', 'meta');
    expectInt(body.meta, 'total', 'meta');
    expectInt(body.meta, 'totalPages', 'meta');
  }
}

async function surfaceProductDetail() {
  const slug = 'osb-1009';
  const { status, body } = await get(`/products/${slug}`);
  if (status !== 200) return fail(`/products/${slug}`, `HTTP ${status}`);
  if (!body?.success) return fail(`/products/${slug}`, 'envelope: success !== true');

  /**
   * The server now returns the flat ProductDetailDto directly — the same shape
   * the components read. Asserting the flat contract (not the old nested one)
   * is the whole point: if this passes, no mapper is needed and the flip is a
   * config change.
   */
  const d = body.data;
  checkProductDetail(d, 'data');

  // Declared fields are not enough — the seeded content must be non-empty.
  checks += 1;
  if (!Array.isArray(d.specs) || d.specs.length === 0) {
    fail('data.specs', 'empty — the Specs tab would render nothing');
  }
  checks += 1;
  if (!Array.isArray(d.variantGroups) || d.variantGroups.length === 0) {
    fail('data.variantGroups', 'empty — no variant pills on any product');
  }
  checks += 1;
  if (!Array.isArray(d.featuresEn) || d.featuresEn.length === 0) {
    fail('data.featuresEn', 'empty — the Features tab would render nothing');
  }

  // Each group must carry options, or the selector renders an empty axis.
  for (const [i, group] of (d.variantGroups ?? []).entries()) {
    expectType(group, 'id', 'string', `data.variantGroups[${i}]`);
    expectType(group, 'labelEn', 'string', `data.variantGroups[${i}]`);
    expectType(group, 'labelBn', 'string', `data.variantGroups[${i}]`);
    expectEnum(group, 'kind', ['button', 'swatch'], `data.variantGroups[${i}]`);
    expectType(group, 'options', 'array', `data.variantGroups[${i}]`);
    checks += 1;
    if (!Array.isArray(group.options) || group.options.length === 0) {
      fail(`data.variantGroups[${i}].options`, 'empty axis');
    }
  }

  // The nested shape must be gone, or a component reading it would break.
  for (const gone of ['product', 'specifications', 'categoryColors']) {
    checks += 1;
    if (gone in d) fail(`data.${gone}`, 'nested shape re-introduced — components read the flat DTO');
  }
}

async function surfaceBrands() {
  const { status, body } = await get('/brands');
  if (status !== 200) return fail('/brands', `HTTP ${status}`);
  if (!body?.success) return fail('/brands', 'envelope: success !== true');
  if (!Array.isArray(body.data)) return fail('/brands', 'data is not an array');
  for (let i = 0; i < Math.min(body.data.length, 5); i += 1) {
    checkBrand(body.data[i], `data[${i}]`);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const surfaces = [
  ['1. /homepage         -> HomepageAggregate', surfaceHomepage],
  ['2. /categories/:slug -> CategoryDto + ProductDto[]', surfaceCategory],
  ['3. /products         -> ProductDto[] + meta', surfaceProducts],
  ['4. /products/:slug   -> ProductDetailDto', surfaceProductDetail],
  ['5. /brands           -> BrandDto[]', surfaceBrands],
];

console.log(`Parity check against ${BASE}${PREFIX}`);
console.log(`Internal token: ${TOKEN ? 'present' : 'ABSENT (may hit the rate limit)'}\n`);

for (const [label, fn] of surfaces) {
  const before = failures.length;
  try {
    await fn();
  } catch (error) {
    fail(label, `threw: ${error.message}`);
  }
  const added = failures.length - before;
  console.log(`${added === 0 ? 'PASS' : 'FAIL'}  ${label}${added ? `  (${added} problem${added === 1 ? '' : 's'})` : ''}`);
}

console.log(`\n${checks} field assertions across ${surfaces.length} surfaces.`);

if (failures.length > 0) {
  console.log(`\n${failures.length} MISMATCH${failures.length === 1 ? '' : 'ES'}:\n`);
  for (const f of failures) {
    const value = f.value === undefined ? '' : `  (got: ${JSON.stringify(f.value).slice(0, 80)})`;
    console.log(`  ${f.path}: ${f.message}${value}`);
  }
  process.exit(1);
}

console.log('\nAll five surfaces match the frontend DTOs.');
