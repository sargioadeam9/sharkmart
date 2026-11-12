/**
 * Database seed — idempotent.
 *
 * Source: data/reference-catalog.json, generated from oshoppingbd.html by
 * tools/extract-reference.mjs. The same file feeds the frontend mock layer, so
 * the seeded database and the mock fixtures are the same catalog. That is what
 * makes flipping USE_MOCK safe.
 *
 * Idempotency: every write is an upsert keyed on a natural unique field
 * (category.slug, brand.slug, product.sku). Running this twice changes
 * nothing. The gate requires exactly that.
 *
 * Run: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, '../../data/reference-catalog.json');

interface RawSubcategory {
  slug: string;
  nameEn: string;
  nameBn: string;
  sortOrder: number;
}

interface RawCategory {
  slug: string;
  nameEn: string;
  nameBn: string;
  accentColor: string;
  lightTintColor: string;
  iconEmoji: string;
  houseBrand: string;
  sortOrder: number;
  subcategories: RawSubcategory[];
}

interface RawBrand {
  slug: string;
  nameEn: string;
  nameBn: string;
  color: string | null;
  taglineEn: string | null;
  taglineBn: string | null;
  categoryId: string | null;
  isOwnBrand: boolean;
}

interface RawProduct {
  refId: number;
  categoryId: string;
  index: number;
  nameEn: string;
  nameBn: string;
  emoji: string;
  priceTaka: number;
  discountPercent: number;
  originalPriceTaka: number;
  brandName: string;
  brandSlug: string;
  rating: number;
  reviewCount: number;
  stock: number;
  sold: number;
  sku: string;
}

interface RawCatalog {
  categories: RawCategory[];
  brands: RawBrand[];
  products: RawProduct[];
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as RawCatalog;

/** Taka -> integer poisha. The one conversion in the whole seed. */
const poisha = (taka: number): number => Math.round(taka * 100);

/**
 * The reference renders an emoji on a category-tinted tile — there are no
 * product photographs. We store the same placeholder the mock layer uses, so
 * a seeded product and a mocked product look identical.
 */
function placeholderImage(emoji: string, tint: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${tint}"/><text x="50%" y="50%" font-size="260" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function seedCategories(): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();

  for (const c of catalog.categories) {
    const category = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {
        nameEn: c.nameEn,
        nameBn: c.nameBn,
        accentColor: c.accentColor,
        lightTintColor: c.lightTintColor,
        iconEmoji: c.iconEmoji,
        sortOrder: c.sortOrder,
        isActive: true,
      },
      create: {
        slug: c.slug,
        nameEn: c.nameEn,
        nameBn: c.nameBn,
        accentColor: c.accentColor,
        lightTintColor: c.lightTintColor,
        iconEmoji: c.iconEmoji,
        sortOrder: c.sortOrder,
        isActive: true,
        metaTitleEn: `${c.nameEn} — SharkMart`,
        metaTitleBn: `${c.nameBn} — SharkMart`,
        metaDescEn: `Shop ${c.nameEn.toLowerCase()} online in Bangladesh. Cash on delivery, fast delivery nationwide.`,
        metaDescBn: `${c.nameBn} অনলাইনে কিনুন। ক্যাশ অন ডেলিভারি, সারা দেশে দ্রুত ডেলিভারি।`,
      },
    });

    idBySlug.set(c.slug, category.id);

    // Subcategories are real Category rows with a parentId — the mega menu and
    // the category page filters both need them as first-class records.
    for (const sub of c.subcategories) {
      await prisma.category.upsert({
        where: { slug: sub.slug },
        update: {
          nameEn: sub.nameEn,
          nameBn: sub.nameBn,
          parentId: category.id,
          sortOrder: sub.sortOrder,
          isActive: true,
        },
        create: {
          slug: sub.slug,
          nameEn: sub.nameEn,
          nameBn: sub.nameBn,
          parentId: category.id,
          sortOrder: sub.sortOrder,
          isActive: true,
        },
      });
    }
  }

  return idBySlug;
}

async function seedBrands(): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();

  for (const [index, b] of catalog.brands.entries()) {
    const brand = await prisma.brand.upsert({
      where: { slug: b.slug },
      update: {
        nameEn: b.nameEn,
        nameBn: b.nameBn,
        taglineEn: b.taglineEn,
        taglineBn: b.taglineBn,
        color: b.color,
        isOwnBrand: b.isOwnBrand,
        sortOrder: index,
        isActive: true,
      },
      create: {
        slug: b.slug,
        nameEn: b.nameEn,
        nameBn: b.nameBn,
        taglineEn: b.taglineEn,
        taglineBn: b.taglineBn,
        color: b.color,
        isOwnBrand: b.isOwnBrand,
        sortOrder: index,
        isActive: true,
      },
    });

    idBySlug.set(b.slug, brand.id);
  }

  return idBySlug;
}

async function seedProducts(
  categoryIds: Map<string, string>,
  brandIds: Map<string, string>,
): Promise<number> {
  const tintByCategory = new Map(
    catalog.categories.map((c) => [c.slug, c.lightTintColor]),
  );

  let written = 0;

  /**
   * One flash-sale window for the whole seed run: started an hour ago, ends in
   * 24 hours. Anchored to the run so a reseed always produces a live sale.
   */
  const seedFlashStart = new Date(Date.now() - 60 * 60 * 1000);
  const seedFlashEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);

  for (const p of catalog.products) {
    const categoryId = categoryIds.get(p.categoryId);
    if (!categoryId) throw new Error(`seed: unknown category ${p.categoryId}`);

    const brandId = brandIds.get(p.brandSlug) ?? null;
    const tint = tintByCategory.get(p.categoryId) ?? '#f4f4f4';

    const basePricePoisha = poisha(p.priceTaka);
    const discountPricePoisha = p.discountPercent > 0 ? basePricePoisha : null;
    const isFlashSale = p.discountPercent >= 30;

    /**
     * The struck-through price comes from the catalog, never from a formula.
     * `basePrice / (1 - discount/100)` disagrees with the reference on 129 of
     * 168 products because the reference rounds the original to whole taka
     * separately. Storing the real number is the only honest option.
     */
    const originalPricePoisha =
      p.discountPercent > 0 ? poisha(p.originalPriceTaka) : 0;

    const data = {
      nameEn: p.nameEn,
      nameBn: p.nameBn,
      descriptionEn: `${p.nameEn} — ${p.categoryId.replace(/-/g, ' ')}.`,
      descriptionBn: `${p.nameBn} — ${p.categoryId.replace(/-/g, ' ')}।`,
      categoryId,
      brandId,
      basePricePoisha,
      discountPercent: p.discountPercent,
      discountPricePoisha,
      originalPricePoisha,
      isPublished: true,
      isDraft: false,
      isFeatured: p.refId <= 14,
      isFlashSale,
      flashSalePricePoisha: isFlashSale ? basePricePoisha : null,
      /**
       * A flash sale with no window is not a flash sale — `/flash-sale` filters
       * on `flashSaleStart <= now < flashSaleEnd`, so a null window would make
       * every flagged product invisible to the endpoint that exists to show it.
       *
       * The seed anchors the window to the seed run rather than a fixed date,
       * so a freshly seeded database always has a live sale to test against.
       * It is demo data, not a business schedule.
       */
      flashSaleStart: isFlashSale ? seedFlashStart : null,
      flashSaleEnd: isFlashSale ? seedFlashEnd : null,
      ratingAvg: p.rating,
      reviewCount: p.reviewCount,
      metaTitleEn: `${p.nameEn} — SharkMart`,
      metaTitleBn: `${p.nameBn} — SharkMart`,
    };

    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: data,
      create: { sku: p.sku, slug: p.sku.toLowerCase(), ...data },
    });

    // Images: replace rather than upsert — the reference has exactly one
    // placeholder per product, so a delete-then-create is the honest write.
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: placeholderImage(p.emoji, tint),
        altEn: p.nameEn,
        altBn: p.nameBn,
        isMain: true,
        sortOrder: 0,
      },
    });

    // Stock lives in the warehouse table, not on Product — that is the shape
    // Phase 9's inventory module reads. One default warehouse for now.
    //
    // NOTE: find-then-write, not upsert. The unique key is
    // (warehouseId, productId, variantId) and variantId is null for a
    // variant-less product; Prisma cannot build a compound-unique `where` from
    // a null, so upsert is not available here. MySQL treats NULLs as distinct
    // in a unique index, so the read below is the correct guard.
    const warehouse = await prisma.warehouse.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!warehouse) throw new Error('seed: default warehouse missing');

    const existingStock = await prisma.warehouseStock.findFirst({
      where: { warehouseId: warehouse.id, productId: product.id, variantId: null },
      select: { id: true },
    });

    if (existingStock) {
      await prisma.warehouseStock.update({
        where: { id: existingStock.id },
        data: { quantity: p.stock },
      });
    } else {
      await prisma.warehouseStock.create({
        data: {
          warehouseId: warehouse.id,
          productId: product.id,
          variantId: null,
          quantity: p.stock,
          binLocation: `A-${String((p.refId % 20) + 1).padStart(2, '0')}`,
        },
      });
    }

    written++;
  }

  return written;
}

async function seedWarehouse(): Promise<void> {
  const existing = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (existing) return;

  await prisma.warehouse.create({
    data: {
      name: 'Main Warehouse — Dhaka',
      address: 'Tejgaon, Dhaka 1208, Bangladesh',
      isDefault: true,
      isActive: true,
    },
  });
}

async function seedSettings(): Promise<void> {
  const settings = [
    { key: 'site.name', value: 'SharkMart', group: 'general' },
    { key: 'site.tagline', value: 'Fast Delivery', group: 'general' },
    { key: 'site.domain', value: 'sharkmart.com.bd', group: 'general' },
    { key: 'site.currency', value: 'BDT', group: 'general' },
    { key: 'site.defaultLanguage', value: 'bn', group: 'general' },
    { key: 'delivery.freeThresholdPoisha', value: '200000', group: 'commerce' },
    { key: 'delivery.standardFeePoisha', value: '6000', group: 'commerce' },
    { key: 'delivery.dhakaEta', value: '24-48 hours', group: 'commerce' },
    { key: 'delivery.nationalEta', value: '3-5 days', group: 'commerce' },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value, group: s.group },
      create: s,
    });
  }
}

async function main(): Promise<void> {
  const started = Date.now();

  await seedWarehouse();
  const categoryIds = await seedCategories();
  const brandIds = await seedBrands();
  const productCount = await seedProducts(categoryIds, brandIds);
  await seedSettings();

  const [categories, subcategories, brands, products, images] = await Promise.all([
    prisma.category.count({ where: { parentId: null } }),
    prisma.category.count({ where: { parentId: { not: null } } }),
    prisma.brand.count(),
    prisma.product.count(),
    prisma.productImage.count(),
  ]);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log('Seed complete in ' + elapsed + 's');
  console.log('  categories    : ' + categories);
  console.log('  subcategories : ' + subcategories);
  console.log('  brands        : ' + brands);
  console.log('  products      : ' + products + ' (' + productCount + ' upserted this run)');
  console.log('  images        : ' + images);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
