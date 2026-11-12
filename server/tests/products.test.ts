/**
 * Product listing, filtering, sorting, detail and draft isolation.
 *
 * Runs against the real seeded catalog (168 published products). Assertions are
 * written against relationships that must hold for any correct implementation
 * — page sizes, monotonic sorts, subset relationships — rather than against
 * hardcoded counts that a reseed would invalidate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, resetState, expectSuccess, expectFailure, prisma } from './helpers.js';

beforeAll(async () => {
  await resetState();
});

describe('pagination boundaries', () => {
  it('page 1 returns exactly `limit` items', async () => {
    const res = await api('/products?page=1&limit=10');
    expectSuccess(res.body);
    expect((res.body.data as unknown[]).length).toBe(10);
    expect(res.body.meta?.page).toBe(1);
  });

  it('the last page returns the remainder, not a full page', async () => {
    const first = await api('/products?page=1&limit=10');
    expectSuccess(first.body);
    const total = first.body.meta!.total;
    const lastPage = Math.ceil(total / 10);

    const last = await api(`/products?page=${lastPage}&limit=10`);
    expectSuccess(last.body);
    const expected = total - (lastPage - 1) * 10;
    expect((last.body.data as unknown[]).length).toBe(expected);
  });

  it('beyond the last page returns an empty array with honest meta', async () => {
    const first = await api('/products?page=1&limit=10');
    expectSuccess(first.body);
    const beyond = Math.ceil(first.body.meta!.total / 10) + 5;

    const res = await api(`/products?page=${beyond}&limit=10`);
    expect(res.status).toBe(200);
    expectSuccess(res.body);
    expect((res.body.data as unknown[]).length).toBe(0);
    expect(res.body.meta?.page).toBe(beyond);
    expect(res.body.meta?.total).toBe(first.body.meta!.total);
  });

  it('consecutive pages do not overlap', async () => {
    const p1 = await api('/products?page=1&limit=10');
    const p2 = await api('/products?page=2&limit=10');
    expectSuccess(p1.body);
    expectSuccess(p2.body);

    const ids1 = new Set((p1.body.data as { id: string }[]).map((p) => p.id));
    const ids2 = (p2.body.data as { id: string }[]).map((p) => p.id);
    expect(ids2.some((id) => ids1.has(id))).toBe(false);
  });

  it('rejects page 0 and a non-integer page', async () => {
    expect((await api('/products?page=0')).status).toBe(422);
    expect((await api('/products?page=1.5')).status).toBe(422);
  });

  it('rejects limit above the public cap', async () => {
    const res = await api('/products?limit=101');
    expect(res.status).toBe(422);
    expectFailure(res.body);
  });
});

describe('sorting', () => {
  it('price_asc is non-decreasing', async () => {
    const res = await api('/products?sort=price_asc&limit=50');
    expectSuccess(res.body);
    const prices = (res.body.data as { pricePoisha: number }[]).map((p) => p.pricePoisha);
    const sorted = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  it('price_desc is non-increasing', async () => {
    const res = await api('/products?sort=price_desc&limit=50');
    expectSuccess(res.body);
    const prices = (res.body.data as { pricePoisha: number }[]).map((p) => p.pricePoisha);
    const sorted = [...prices].sort((a, b) => b - a);
    expect(prices).toEqual(sorted);
  });

  it('rating is non-increasing', async () => {
    const res = await api('/products?sort=rating&limit=50');
    expectSuccess(res.body);
    const ratings = (res.body.data as { rating: number }[]).map((p) => p.rating);
    const sorted = [...ratings].sort((a, b) => b - a);
    expect(ratings).toEqual(sorted);
  });

  it('an invalid sort key is a 422, not a silent fallback', async () => {
    const res = await api('/products?sort=cheapest');
    expect(res.status).toBe(422);
    expectFailure(res.body);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('filters', () => {
  it('category filter returns only that category', async () => {
    const res = await api('/products?category=fashion&limit=100');
    expectSuccess(res.body);
    const items = res.body.data as { category: { slug: string } }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.category.slug === 'fashion')).toBe(true);
  });

  it('brand filter returns only that brand', async () => {
    const res = await api('/products?brand=samsung&limit=100');
    expectSuccess(res.body);
    const items = res.body.data as { brand: { slug: string } | null }[];
    expect(items.every((p) => p.brand?.slug === 'samsung')).toBe(true);
  });

  it('price range is inclusive and respected', async () => {
    const res = await api('/products?minPricePoisha=100000&maxPricePoisha=500000&limit=100');
    expectSuccess(res.body);
    const items = res.body.data as { pricePoisha: number }[];
    expect(items.every((p) => p.pricePoisha >= 100000 && p.pricePoisha <= 500000)).toBe(true);
  });

  it('min > max is rejected with a field-level message', async () => {
    const res = await api('/products?minPricePoisha=900000&maxPricePoisha=100000');
    expect(res.status).toBe(422);
    expectFailure(res.body);
    const details = res.body.error.details as { field: string; message: string }[];
    expect(details.some((d) => d.field === 'minPricePoisha')).toBe(true);
  });

  it('an unknown query key is rejected, not ignored', async () => {
    const res = await api('/products?catgory=fashion');
    expect(res.status).toBe(422);
    expectFailure(res.body);
  });

  it('onDiscountOnly returns only discounted products', async () => {
    const res = await api('/products?onDiscountOnly=1&limit=100');
    expectSuccess(res.body);
    const items = res.body.data as { discountPercent: number }[];
    expect(items.every((p) => p.discountPercent > 0)).toBe(true);
  });

  it('ratingMin floors the rating', async () => {
    const res = await api('/products?ratingMin=4&limit=100');
    expectSuccess(res.body);
    const items = res.body.data as { rating: number }[];
    expect(items.every((p) => p.rating >= 4)).toBe(true);
  });
});

describe('product detail', () => {
  it('returns the flat detail shape the storefront consumes', async () => {
    const list = await api('/products?limit=1');
    expectSuccess(list.body);
    const slug = (list.body.data as { slug: string }[])[0]!.slug;

    const res = await api(`/products/${slug}`);
    expect(res.status).toBe(200);
    expectSuccess(res.body);
    const detail = res.body.data as Record<string, unknown>;

    // The flat ProductDetailDto — every field a component reads, on the wire.
    expect(detail).toHaveProperty('slug');
    expect(detail).toHaveProperty('variantGroups');
    expect(detail).toHaveProperty('reviews');
    expect(detail).toHaveProperty('ratingBreakdown');
    expect(detail).toHaveProperty('featuresEn');
    expect(detail).toHaveProperty('featuresBn');
    expect(detail).toHaveProperty('specs');
    expect(detail).toHaveProperty('tintColor');
    expect(detail).toHaveProperty('accentColor');
    expect(detail).toHaveProperty('relatedIds');

    // The nested shape is gone: nothing may re-introduce it silently.
    expect(detail).not.toHaveProperty('product');
    expect(detail).not.toHaveProperty('specifications');
    expect(detail).not.toHaveProperty('categoryColors');

    // Seeded content must actually be present, not just declared.
    expect(Array.isArray(detail.specs)).toBe(true);
    expect((detail.specs as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(detail.variantGroups)).toBe(true);
    expect((detail.variantGroups as unknown[]).length).toBeGreaterThan(0);
    expect((detail.featuresEn as unknown[]).length).toBeGreaterThan(0);
  });

  it('never leaks costPrice or internal fields', async () => {
    const list = await api('/products?limit=5');
    expectSuccess(list.body);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain('costPrice');
    expect(raw).not.toContain('costPricePoisha');
  });

  it('a malformed slug is a 422 before it reaches the database', async () => {
    const res = await api('/products/Not_A_Slug!!');
    expect(res.status).toBe(422);
    expectFailure(res.body);
  });
});

describe('draft isolation', () => {
  const draftSlug = 'zz-phase6-draft-probe';

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { slug: draftSlug } });
  });

  it('a draft product never appears in a public response', async () => {
    const category = await prisma.category.findFirst({ select: { id: true, slug: true } });
    expect(category).not.toBeNull();

    await prisma.product.create({
      data: {
        slug: draftSlug,
        sku: 'ZZ-DRAFT-0001',
        nameEn: 'Phase6 Draft Probe',
        nameBn: 'ফেজ সিক্স ড্রাফট প্রোব',
        descriptionEn: 'Should never be public.',
        descriptionBn: 'কখনো পাবলিক হবে না।',
        basePricePoisha: 123400,
        originalPricePoisha: 123400,
        categoryId: category!.id,
        isPublished: false,
        isDraft: true,
      },
    });

    // Not in the listing.
    const list = await api(`/products?category=${category!.slug}&limit=100`);
    expectSuccess(list.body);
    expect((list.body.data as { slug: string }[]).some((p) => p.slug === draftSlug)).toBe(false);

    // Not in search.
    const search = await api('/search?q=Phase6%20Draft%20Probe');
    expectSuccess(search.body);
    expect((search.body.data as { slug: string }[]).some((p) => p.slug === draftSlug)).toBe(false);

    // Not reachable by direct slug.
    const detail = await api(`/products/${draftSlug}`);
    expect(detail.status).toBe(404);

    // Not in the slug list the storefront prerenders.
    const slugs = await api('/products/slugs?limit=500');
    expectSuccess(slugs.body);
    expect((slugs.body.data as string[]).includes(draftSlug)).toBe(false);
  });
});
