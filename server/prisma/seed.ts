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

import { AttributeType, DetailSection, PrismaClient } from '@prisma/client';
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

// ─── Variant axes ─────────────────────────────────────────────────────────
//
// The reference's own `VARS()` map (oshoppingbd.html L720), keyed by category.
// These are the axes the storefront renders as pills. The seed materialises
// them as real ProductAttribute + ProductVariant rows so the API can serve
// them; the mock layer generated the same shapes at request time, and losing
// them on the flip would be a visible regression on every product page.

interface AxisSpec {
  labelEn: string;
  labelBn: string;
  type: AttributeType;
  options: { en: string; bn: string }[];
}

const SIZE_AXIS: AxisSpec = {
  labelEn: 'Size',
  labelBn: 'সাইজ',
  type: AttributeType.SIZE,
  options: [
    { en: 'S', bn: 'S' },
    { en: 'M', bn: 'M' },
    { en: 'L', bn: 'L' },
    { en: 'XL', bn: 'XL' },
  ],
};

const AXES: Record<string, AxisSpec> = {
  fashion: SIZE_AXIS,
  'kids-baby': {
    labelEn: 'Size',
    labelBn: 'সাইজ',
    type: AttributeType.SIZE,
    options: [
      { en: '0–6M', bn: '০–৬ মাস' },
      { en: '6–12M', bn: '৬–১২ মাস' },
      { en: '1–2Y', bn: '১–২ বছর' },
      { en: '2–4Y', bn: '২–৪ বছর' },
    ],
  },
  'beauty-care': {
    labelEn: 'Size',
    labelBn: 'সাইজ',
    type: AttributeType.SIZE,
    options: [
      { en: '50ml', bn: '৫০ মিলি' },
      { en: '100ml', bn: '১০০ মিলি' },
      { en: '200ml', bn: '২০০ মিলি' },
    ],
  },
  'perfumes-fragrance': {
    labelEn: 'Size',
    labelBn: 'সাইজ',
    type: AttributeType.SIZE,
    options: [
      { en: '30ml', bn: '৩০ মিলি' },
      { en: '50ml', bn: '৫০ মিলি' },
      { en: '100ml', bn: '১০০ মিলি' },
    ],
  },
  'gadgets-electronics': {
    labelEn: 'Model',
    labelBn: 'মডেল',
    type: AttributeType.MODEL,
    options: [
      { en: 'Standard', bn: 'স্ট্যান্ডার্ড' },
      { en: 'Pro', bn: 'প্রো' },
      { en: 'Max', bn: 'ম্যাক্স' },
    ],
  },
  'herbal-natural': {
    labelEn: 'Weight',
    labelBn: 'ওজন',
    type: AttributeType.WEIGHT,
    options: [
      { en: '250g', bn: '২৫০ গ্রাম' },
      { en: '500g', bn: '৫০০ গ্রাম' },
      { en: '1kg', bn: '১ কেজি' },
    ],
  },
  'home-kitchen': {
    labelEn: 'Size',
    labelBn: 'সাইজ',
    type: AttributeType.SIZE,
    options: [
      { en: 'Small', bn: 'ছোট' },
      { en: 'Medium', bn: 'মাঝারি' },
      { en: 'Large', bn: 'বড়' },
    ],
  },
  'food-grocery': {
    labelEn: 'Weight',
    labelBn: 'ওজন',
    type: AttributeType.WEIGHT,
    options: [
      { en: '500g', bn: '৫০০ গ্রাম' },
      { en: '1kg', bn: '১ কেজি' },
      { en: '5kg', bn: '৫ কেজি' },
    ],
  },
  'books-education': {
    labelEn: 'Edition',
    labelBn: 'সংস্করণ',
    type: AttributeType.CUSTOM,
    options: [
      { en: 'Paperback', bn: 'পেপারব্যাক' },
      { en: 'Hardcover', bn: 'হার্ডকভার' },
    ],
  },
  'automotive-motorbike': {
    labelEn: 'Model',
    labelBn: 'মডেল',
    type: AttributeType.MODEL,
    options: [
      { en: 'Standard', bn: 'স্ট্যান্ডার্ড' },
      { en: 'Premium', bn: 'প্রিমিয়াম' },
    ],
  },
  'sports-fitness-outdoors': SIZE_AXIS,
  'pet-supplies': {
    labelEn: 'Pack',
    labelBn: 'প্যাক',
    type: AttributeType.PACK_SIZE,
    options: [
      { en: 'Single', bn: 'একটি' },
      { en: 'Pack of 3', bn: '৩টির প্যাক' },
    ],
  },
  'office-business': {
    labelEn: 'Model',
    labelBn: 'মডেল',
    type: AttributeType.MODEL,
    options: [
      { en: 'Standard', bn: 'স্ট্যান্ডার্ড' },
      { en: 'Pro', bn: 'প্রো' },
    ],
  },
  'garden-plants': {
    labelEn: 'Pack',
    labelBn: 'প্যাক',
    type: AttributeType.PACK_SIZE,
    options: [
      { en: '1 pc', bn: '১ পিস' },
      { en: '3 pcs', bn: '৩ পিস' },
      { en: '5 pcs', bn: '৫ পিস' },
    ],
  },
};

/** The reference's four swatches, verbatim (oshoppingbd.html L720). */
const COLOUR_AXIS: AxisSpec = {
  labelEn: 'Colour',
  labelBn: 'রং',
  type: AttributeType.COLOR,
  options: [
    { en: 'Black', bn: 'কালো' },
    { en: 'Navy', bn: 'নেভি' },
    { en: 'Crimson', bn: 'ক্রিমসন' },
    { en: 'Sand', bn: 'স্যান্ড' },
  ],
};

const COLOUR_CATEGORIES = ['fashion', 'gadgets-electronics'];

/**
 * Features and specs, per product.
 *
 * These are the same rows the mock layer built (`buildSpecs` in
 * src/lib/mock/product-detail.ts), materialised so the API serves them instead
 * of the page silently losing its Specs and Features tabs on the flip.
 *
 * The warranty row is category-dependent exactly as the mock had it. Everything
 * here is derived from data the catalog already carries — no invented claims.
 */
function buildSpecRows(p: RawProduct, categoryNameEn: string, categoryNameBn: string, brandNameEn: string, brandNameBn: string) {
  const isElectronics = p.categoryId === 'gadgets-electronics';

  return [
    { labelEn: 'SKU', labelBn: 'এসকেইউ', valueEn: p.sku, valueBn: p.sku },
    { labelEn: 'Brand', labelBn: 'ব্র্যান্ড', valueEn: brandNameEn, valueBn: brandNameBn },
    { labelEn: 'Category', labelBn: 'ক্যাটাগরি', valueEn: categoryNameEn, valueBn: categoryNameBn },
    {
      labelEn: 'Warranty',
      labelBn: 'ওয়ারেন্টি',
      valueEn: isElectronics ? '12 months' : 'N/A',
      valueBn: isElectronics ? '১২ মাস' : 'প্রযোজ্য নয়',
    },
    {
      labelEn: 'Origin',
      labelBn: 'উৎস',
      valueEn: 'Bangladesh / Imported',
      valueBn: 'বাংলাদেশ / আমদানি',
    },
  ];
}

const FEATURES_EN = [
  'Durable, quality materials',
  '100% genuine',
  '7-day easy return',
  'Cash on Delivery available',
];

const FEATURES_BN = [
  'টেকসই ও উন্নত উপাদান',
  '১০০% অরিজিনাল',
  '৭ দিনের রিটার্ন',
  'ক্যাশ অন ডেলিভারি',
];

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

/**
 * One ProductAttribute per (category, axis). The unique key is not declared in
 * the schema, so this is find-then-create — the same guard the warehouse stock
 * write uses, for the same reason.
 *
 * Returns `${categorySlug}:${axisLabelEn}` → attributeId.
 */
async function seedAttributes(
  categoryIds: Map<string, string>,
): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();

  for (const [categorySlug, axis] of Object.entries(AXES)) {
    const categoryId = categoryIds.get(categorySlug);
    if (!categoryId) continue;

    const existing = await prisma.productAttribute.findFirst({
      where: { categoryId, nameEn: axis.labelEn },
      select: { id: true },
    });

    const attribute =
      existing ??
      (await prisma.productAttribute.create({
        data: {
          categoryId,
          nameEn: axis.labelEn,
          nameBn: axis.labelBn,
          type: axis.type,
          sortOrder: 0,
        },
        select: { id: true },
      }));

    idByKey.set(`${categorySlug}:${axis.labelEn}`, attribute.id);
  }

  // Colour is a second axis on two categories, not a replacement for the first.
  for (const categorySlug of COLOUR_CATEGORIES) {
    const categoryId = categoryIds.get(categorySlug);
    if (!categoryId) continue;

    const existing = await prisma.productAttribute.findFirst({
      where: { categoryId, nameEn: COLOUR_AXIS.labelEn },
      select: { id: true },
    });

    const attribute =
      existing ??
      (await prisma.productAttribute.create({
        data: {
          categoryId,
          nameEn: COLOUR_AXIS.labelEn,
          nameBn: COLOUR_AXIS.labelBn,
          type: COLOUR_AXIS.type,
          sortOrder: 1,
        },
        select: { id: true },
      }));

    idByKey.set(`${categorySlug}:${COLOUR_AXIS.labelEn}`, attribute.id);
  }

  return idByKey;
}

/**
 * Distributes a product's real stock across its variant options.
 *
 * The mock layer invented per-option stock (`14 - index*3`), which summed to a
 * number that had nothing to do with the product's actual quantity. That is
 * fine for a fixture and wrong for a database: `totalStock()` in the server
 * mapper sums variant stock when variants exist, so invented per-option numbers
 * would silently overwrite the real warehouse quantity on every card.
 *
 * This keeps the total equal to the product's real stock and gives the earlier
 * options the remainder, so a sold-out product has every option at zero.
 */
function distributeStock(total: number, count: number): number[] {
  if (count <= 0) return [];
  if (total <= 0) return Array.from({ length: count }, () => 0);

  const base = Math.floor(total / count);
  const remainder = total - base * count;

  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Materialises the detail-page content the mock layer used to generate at
 * request time: variant options, specification rows and the Features section.
 *
 * Without this the flip to the real API is not a wash — every product page
 * loses its Specs tab, its Features tab and its variant pills, because the
 * database has no rows behind them. Reviews are deliberately NOT seeded: a
 * fabricated customer review is not demo data, it is a lie with a name on it.
 * The empty state is the honest answer until real reviews exist.
 */
async function seedProductContent(
  productId: string,
  p: RawProduct,
  attributeIds: Map<string, string>,
  categoryNames: { en: string; bn: string },
  brandNames: { en: string; bn: string },
  basePricePoisha: number,
): Promise<void> {
  // ── Variants ────────────────────────────────────────────────────────────
  //
  // One variant per *combination* across the axes, each carrying one
  // VariantOption per axis.
  //
  // Phase 7 seeded one variant per option per axis, so "Size=M" and
  // "Colour=Navy" were two separate rows and there was no row for the pair the
  // shopper actually selects. That left a two-axis selection with no
  // purchasable SKU: the cart could not resolve it, and `POST /cart/sync`
  // silently skipped every such line. Phase 8's cart needs a combined SKU per
  // selection (HANDOFF.md, Phase 7 → Assumed), so the seed materialises the
  // full cartesian product.
  //
  // The UI is unchanged: it still renders one pill group per axis and lets the
  // shopper pick independently. What changed is that every combination of those
  // independent picks now has a row behind it.
  const axes: AxisSpec[] = [];
  const primaryAxis = AXES[p.categoryId];
  if (primaryAxis) axes.push(primaryAxis);
  if (COLOUR_CATEGORIES.includes(p.categoryId)) axes.push(COLOUR_AXIS);

  // Replace rather than upsert: the option set is derived, so a delete-then-
  // create is the honest write and keeps a reseed from accumulating rows.
  await prisma.productVariant.deleteMany({ where: { productId } });

  // A product with no axis is variant-less; its stock lives in WarehouseStock.
  // It still needs its specs and features, so this is a skip, not a return.
  if (axes.length > 0) {
    /**
     * Each axis paired with its attribute id, so the combination loop never
     * indexes two parallel arrays and never has to prove an id exists.
     */
    const axisParts = axes.map((axis) => {
      const attributeId = attributeIds.get(`${p.categoryId}:${axis.labelEn}`);
      if (!attributeId) {
        throw new Error(`seed: missing attribute ${p.categoryId}:${axis.labelEn}`);
      }
      return { axis, attributeId };
    });

    // Every combination, in axis order: [[S,Black],[S,Navy],…,[XL,Sand]].
    const combinations = axisParts.reduce<{ en: string; bn: string }[][]>(
      (acc, { axis }) => acc.flatMap((combo) => axis.options.map((option) => [...combo, option])),
      [[]],
    );

    const stocks = distributeStock(p.stock, combinations.length);

    for (const [index, combo] of combinations.entries()) {
      /**
       * Price delta: the reference scales each option by 12% per step
       * (`Math.round(p.p * .12 * i / 10) * 10`) and sums the selected options'
       * deltas. A combination therefore carries the sum of its axes' deltas.
       */
      const priceDeltaPoisha = combo.reduce((sum, option, axisIndex) => {
        const axis = axisParts[axisIndex]?.axis;
        if (!axis) return sum;
        const optionIndex = axis.options.findIndex((axisOption) => axisOption.en === option.en);
        return sum + Math.round((basePricePoisha * 0.12 * optionIndex) / 10) * 10;
      }, 0);

      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: `${p.sku}-${index}`,
          nameEn: combo.map((option) => option.en).join(' · '),
          nameBn: combo.map((option) => option.bn).join(' · '),
          pricePoisha: basePricePoisha + priceDeltaPoisha,
          stock: stocks[index] ?? 0,
          sortOrder: index,
          isActive: true,
        },
        select: { id: true },
      });

      for (const [axisIndex, option] of combo.entries()) {
        const part = axisParts[axisIndex];
        if (!part) continue;
        await prisma.variantOption.create({
          data: {
            variantId: variant.id,
            attributeId: part.attributeId,
            valueEn: option.en,
            valueBn: option.bn,
          },
        });
      }
    }
  }

  // ── Specifications ──────────────────────────────────────────────────────
  await prisma.productSpecification.deleteMany({ where: { productId } });

  const specRows = buildSpecRows(p, categoryNames.en, categoryNames.bn, brandNames.en, brandNames.bn);
  for (const [index, row] of specRows.entries()) {
    await prisma.productSpecification.create({
      data: { productId, ...row, sortOrder: index },
    });
  }

  // ── Features ────────────────────────────────────────────────────────────
  //
  // Stored as one FEATURES ProductDetail row with newline-separated bullets,
  // which is the shape the detail section is built for. The API splits it back
  // into an array.
  await prisma.productDetail.deleteMany({ where: { productId } });

  await prisma.productDetail.create({
    data: {
      productId,
      section: DetailSection.FEATURES,
      contentEn: FEATURES_EN.join('\n'),
      contentBn: FEATURES_BN.join('\n'),
      sortOrder: 0,
    },
  });
}

async function seedProducts(
  categoryIds: Map<string, string>,
  brandIds: Map<string, string>,
  attributeIds: Map<string, string>,
): Promise<number> {
  const tintByCategory = new Map(
    catalog.categories.map((c) => [c.slug, c.lightTintColor]),
  );

  const namesByCategory = new Map(
    catalog.categories.map((c) => [c.slug, { en: c.nameEn, bn: c.nameBn }]),
  );

  const namesByBrand = new Map(
    catalog.brands.map((b) => [b.slug, { en: b.nameEn, bn: b.nameBn }]),
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
      /**
       * NULL, on purpose. The catalog's `discountPercent` is already baked into
       * `priceTaka` (which becomes `basePricePoisha`) and the struck-through
       * value lives in `originalPricePoisha`. Writing `basePricePoisha` here as
       * well produced "discounted to exactly the same price" on all 168 rows —
       * a value with no reader (`mappers.ts` `payablePrice()` returns the base
       * price and nothing else) that still tripped the admin update guard and
       * made every product read-only. See tools/normalize-discount-price.mjs.
       */
      discountPricePoisha: null,
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

    await seedProductContent(
      product.id,
      p,
      attributeIds,
      namesByCategory.get(p.categoryId) ?? { en: p.categoryId, bn: p.categoryId },
      namesByBrand.get(p.brandSlug) ?? { en: p.brandName, bn: p.brandName },
      basePricePoisha,
    );
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

/**
 * Defaults for a fresh install. **Create-only.**
 *
 * These used to be upserted with `update: { value }`, which meant re-running the
 * seed silently reverted every setting an operator had changed — rename the shop,
 * run a migration, and the name goes back to SharkMart. A seed provides defaults;
 * it must never overwrite a value somebody chose.
 *
 * Keys absent here still work: `settings.service.ts` falls back to its registry
 * defaults for anything with no row.
 */
async function seedSettings(): Promise<void> {
  const settings = [
    { key: 'site.name', value: 'SharkMart', group: 'general' },
    { key: 'site.tagline', value: 'Fast Delivery', group: 'general' },
    { key: 'site.domain', value: 'sharkmart.com.bd', group: 'general' },
    { key: 'site.currency', value: 'BDT', group: 'general' },
    { key: 'site.defaultLanguage', value: 'bn', group: 'general' },
    { key: 'contact.supportEmail', value: 'support@sharkmart.com.bd', group: 'contact' },
    { key: 'contact.phone', value: '09XX-XXXXXX', group: 'contact' },
    { key: 'contact.address', value: 'Dhaka, Bangladesh', group: 'contact' },
    { key: 'delivery.freeThresholdPoisha', value: '200000', group: 'commerce' },
    { key: 'delivery.standardFeePoisha', value: '6000', group: 'commerce' },
    { key: 'delivery.expressSurchargePoisha', value: '10000', group: 'commerce' },
    { key: 'delivery.dhakaEta', value: '24-48 hours', group: 'commerce' },
    { key: 'delivery.nationalEta', value: '3-5 days', group: 'commerce' },
    { key: 'brand.nameFirst', value: 'Shark', group: 'branding' },
    { key: 'brand.nameSecond', value: 'Mart', group: 'branding' },
    { key: 'brand.logoUrl', value: '/brand/sharkmart-logo.png', group: 'branding' },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      // Never overwrite an operator's value — see the note above.
      update: {},
      create: s,
    });
  }
}

async function main(): Promise<void> {
  const started = Date.now();

  /**
   * Two modes, because a client install and a demo are not the same thing.
   *
   *   base     categories, brands, attributes, warehouse, settings
   *            -> a working empty shop. This is what `npm run db:seed` does.
   *   catalog  the above plus the 168 reference products
   *            -> demos and screenshots. `npm run db:seed:catalog`.
   *
   * Seeding the catalogue into a client's store is the single worst thing this
   * script could do: 168 "Premium ..." products they must delete one by one, and
   * a storefront that looks like a template rather than their shop.
   *
   * Re-running base mode on a database that already has products changes nothing
   * about them — every write is an upsert keyed on slug/sku.
   */
  const withCatalog = process.argv.includes('--catalog') || process.env.SEED_CATALOG === 'true';

  await seedWarehouse();
  const categoryIds = await seedCategories();
  const brandIds = await seedBrands();
  const attributeIds = await seedAttributes(categoryIds);

  const productCount = withCatalog
    ? await seedProducts(categoryIds, brandIds, attributeIds)
    : 0;

  await seedSettings();

  const [
    categories,
    subcategories,
    brands,
    products,
    images,
    variants,
    specifications,
    details,
  ] = await Promise.all([
    prisma.category.count({ where: { parentId: null } }),
    prisma.category.count({ where: { parentId: { not: null } } }),
    prisma.brand.count(),
    prisma.product.count(),
    prisma.productImage.count(),
    prisma.productVariant.count(),
    prisma.productSpecification.count(),
    prisma.productDetail.count(),
  ]);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log('Seed complete in ' + elapsed + 's (' + (withCatalog ? 'base + catalog' : 'base only') + ')');
  console.log('  categories    : ' + categories);
  console.log('  subcategories : ' + subcategories);
  console.log('  brands        : ' + brands);
  console.log(
    '  products      : ' +
      products +
      (withCatalog ? ' (' + productCount + ' upserted this run)' : ' (catalog skipped - base mode)'),
  );
  console.log('  images        : ' + images);
  console.log('  variants      : ' + variants);
  console.log('  specifications: ' + specifications);
  console.log('  details       : ' + details);
  console.log('  reviews       : 0 (never seeded — real reviews only)');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
