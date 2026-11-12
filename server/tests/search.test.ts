/**
 * Bilingual search.
 *
 * The gate: "Bilingual search returns sensible results in both scripts."
 * The catalog stores `nameEn` and `nameBn` as separate columns, so the same
 * product must be reachable from either script. These tests take a real
 * product's two names and prove both find it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { api, resetState, expectSuccess, expectFailure, prisma } from './helpers.js';

beforeAll(async () => {
  await resetState();
});

describe('search', () => {
  it('an English term finds the product by its English name', async () => {
    const res = await api('/search?q=yoga');
    expect(res.status).toBe(200);
    expectSuccess(res.body);
    const items = res.body.data as { nameEn: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.nameEn.toLowerCase().includes('yoga'))).toBe(true);
  });

  it('a Bangla term finds the same product by its Bangla name', async () => {
    // Pull a real product so the term is guaranteed to exist in the seed.
    const product = await prisma.product.findFirst({
      where: { isPublished: true, isDraft: false, nameBn: { contains: 'যোগা' } },
      select: { nameBn: true, nameEn: true },
    });
    expect(product).not.toBeNull();

    const term = product!.nameBn.split(' ')[1] ?? product!.nameBn;
    const res = await api(`/search?q=${encodeURIComponent(term)}`);
    expect(res.status).toBe(200);
    expectSuccess(res.body);
    const items = res.body.data as { nameBn: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((p) => p.nameBn.includes(term))).toBe(true);
  });

  it('the same product is reachable from both scripts', async () => {
    const product = await prisma.product.findFirst({
      where: { isPublished: true, isDraft: false, nameBn: { contains: 'যোগা' } },
      select: { slug: true, nameEn: true, nameBn: true },
    });
    expect(product).not.toBeNull();

    const enTerm = product!.nameEn.split(' ').pop()!;
    const bnTerm = product!.nameBn.split(' ').pop()!;

    const en = await api(`/search?q=${encodeURIComponent(enTerm)}`);
    const bn = await api(`/search?q=${encodeURIComponent(bnTerm)}`);
    expectSuccess(en.body);
    expectSuccess(bn.body);

    const enSlugs = (en.body.data as { slug: string }[]).map((p) => p.slug);
    const bnSlugs = (bn.body.data as { slug: string }[]).map((p) => p.slug);
    expect(enSlugs).toContain(product!.slug);
    expect(bnSlugs).toContain(product!.slug);
  });

  it('a SKU search finds the product', async () => {
    const res = await api('/search?q=OSB-1127');
    expectSuccess(res.body);
    const items = res.body.data as { sku: string }[];
    expect(items.some((p) => p.sku === 'OSB-1127')).toBe(true);
  });

  it('a brand name finds that brand\'s products', async () => {
    const res = await api('/search?q=samsung');
    expectSuccess(res.body);
    const items = res.body.data as { brand: { slug: string } | null }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.brand?.slug === 'samsung')).toBe(true);
  });

  it('a nonsense term returns an empty page, not an error', async () => {
    const res = await api('/search?q=zzzznotathingzzzz');
    expect(res.status).toBe(200);
    expectSuccess(res.body);
    expect((res.body.data as unknown[]).length).toBe(0);
    expect(res.body.meta?.total).toBe(0);
  });

  it('a missing q is a 422', async () => {
    const res = await api('/search');
    expect(res.status).toBe(422);
    expectFailure(res.body);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('search results are paginated', async () => {
    const res = await api('/search?q=a&page=1&limit=5');
    expectSuccess(res.body);
    expect((res.body.data as unknown[]).length).toBeLessThanOrEqual(5);
    expect(res.body.meta?.limit).toBe(5);
  });
});
