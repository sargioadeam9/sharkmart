/**
 * MOCK ONLY — these reviews are generated, not real customer data. They must
 * never reach production; the API replaces them.
 *
 * Product detail fixtures — variant axes, reviews, specs.
 *
 * Split out of `src/lib/mock/index.ts` because the detail page needs a lot more
 * data than a card does, and mixing it into the catalog mapper would make the
 * list path build reviews it never renders.
 *
 * Two rules govern everything here:
 *
 *   1. Nothing is invented that the reference does not imply. The variant axes
 *      are the reference's own `VARS()` map (oshoppingbd.html L720), keyed by
 *      category. The colour swatches are its four hex values.
 *   2. Reviews are NOT fabricated per product. The reference hardcodes five
 *      reviews for every product, which is demo filler (landmine #12). Here a
 *      product either has reviews or it does not, and the page renders the
 *      empty state. `reviewCount` on the DTO stays the source of truth for the
 *      aggregate; the list below is only the sample we can actually show.
 */

import type {
  ProductDetailDto,
  ProductDto,
  ReviewDto,
  VariantGroupDto,
  VariantOptionDto,
} from '@/types/catalog';

// ─── Variant axes, copied from the reference's VARS() map ──────────────────

interface AxisSpec {
  labelEn: string;
  labelBn: string;
  options: { en: string; bn: string }[];
}

const SIZE_AXIS: AxisSpec = {
  labelEn: 'Size',
  labelBn: 'সাইজ',
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
    options: [
      { en: '50ml', bn: '৫০ মিলি' },
      { en: '100ml', bn: '১০০ মিলি' },
      { en: '200ml', bn: '২০০ মিলি' },
    ],
  },
  'perfumes-fragrance': {
    labelEn: 'Size',
    labelBn: 'সাইজ',
    options: [
      { en: '30ml', bn: '৩০ মিলি' },
      { en: '50ml', bn: '৫০ মিলি' },
      { en: '100ml', bn: '১০০ মিলি' },
    ],
  },
  'gadgets-electronics': {
    labelEn: 'Model',
    labelBn: 'মডেল',
    options: [
      { en: 'Standard', bn: 'স্ট্যান্ডার্ড' },
      { en: 'Pro', bn: 'প্রো' },
      { en: 'Max', bn: 'ম্যাক্স' },
    ],
  },
  'herbal-natural': {
    labelEn: 'Weight',
    labelBn: 'ওজন',
    options: [
      { en: '250g', bn: '২৫০ গ্রাম' },
      { en: '500g', bn: '৫০০ গ্রাম' },
      { en: '1kg', bn: '১ কেজি' },
    ],
  },
  'home-kitchen': {
    labelEn: 'Size',
    labelBn: 'সাইজ',
    options: [
      { en: 'Small', bn: 'ছোট' },
      { en: 'Medium', bn: 'মাঝারি' },
      { en: 'Large', bn: 'বড়' },
    ],
  },
  'food-grocery': {
    labelEn: 'Weight',
    labelBn: 'ওজন',
    options: [
      { en: '500g', bn: '৫০০ গ্রাম' },
      { en: '1kg', bn: '১ কেজি' },
      { en: '5kg', bn: '৫ কেজি' },
    ],
  },
  'books-education': {
    labelEn: 'Edition',
    labelBn: 'সংস্করণ',
    options: [
      { en: 'Paperback', bn: 'পেপারব্যাক' },
      { en: 'Hardcover', bn: 'হার্ডকভার' },
    ],
  },
  'automotive-motorbike': {
    labelEn: 'Model',
    labelBn: 'মডেল',
    options: [
      { en: 'Standard', bn: 'স্ট্যান্ডার্ড' },
      { en: 'Premium', bn: 'প্রিমিয়াম' },
    ],
  },
  'sports-fitness-outdoors': SIZE_AXIS,
  'pet-supplies': {
    labelEn: 'Pack',
    labelBn: 'প্যাক',
    options: [
      { en: 'Single', bn: 'একটি' },
      { en: 'Pack of 3', bn: '৩টির প্যাক' },
    ],
  },
  'office-business': {
    labelEn: 'Model',
    labelBn: 'মডেল',
    options: [
      { en: 'Standard', bn: 'স্ট্যান্ডার্ড' },
      { en: 'Pro', bn: 'প্রো' },
    ],
  },
  'garden-plants': {
    labelEn: 'Pack',
    labelBn: 'প্যাক',
    options: [
      { en: '1 pc', bn: '১ পিস' },
      { en: '3 pcs', bn: '৩ পিস' },
      { en: '5 pcs', bn: '৫ পিস' },
    ],
  },
};

/** The reference's four swatches, verbatim (oshoppingbd.html L720). */
const SWATCHES = [
  { en: 'Black', bn: 'কালো', hex: '#1e2430' },
  { en: 'Navy', bn: 'নেভি', hex: '#253858' },
  { en: 'Crimson', bn: 'ক্রিমসন', hex: '#C51F4B' },
  { en: 'Sand', bn: 'স্যান্ড', hex: '#D9B99B' },
];

const COLOUR_CATEGORIES = ['fashion', 'gadgets-electronics'];

/**
 * Deterministic pseudo-random in [0, 1). Seeded by the product's numeric ref so
 * the same product always renders the same stock and deltas across a build, a
 * reload and a server/client pair. A `Math.random()` here would be a hydration
 * mismatch.
 */
function seeded(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function buildGroup(
  axis: AxisSpec,
  kind: 'button' | 'swatch',
  productSeed: number,
  baseStock: number,
  basePricePoisha: number,
): VariantGroupDto {
  const options: VariantOptionDto[] = axis.options.map((option, index) => {
    /**
     * Price delta: the reference scales the option price by 12% per step
     * (`Math.round(p.p * .12 * i / 10) * 10`). Same shape, in poisha.
     */
    const priceDeltaPoisha =
      Math.round((basePricePoisha * 0.12 * index) / 10) * 10;

    /**
     * Stock: the reference makes the last option of some products zero so the
     * out-of-stock path is reachable in the demo. We keep that, but tie it to
     * the product's own stock so a genuinely sold-out product has no in-stock
     * option at all.
     */
    const isLast = index === axis.options.length - 1;
    const soldOutOption = isLast && productSeed % 3 === 0;
    const stock = baseStock <= 0 ? 0 : soldOutOption ? 0 : Math.max(2, 14 - index * 3);

    return {
      id: `var_${productSeed}_${index}`,
      nameEn: option.en,
      nameBn: option.bn,
      priceDeltaPoisha,
      stock,
      swatch: null,
    };
  });

  void kind;
  void seeded;
  return {
    id: `grp_${productSeed}_${axis.labelEn.toLowerCase()}`,
    labelEn: axis.labelEn,
    labelBn: axis.labelBn,
    kind,
    options,
  };
}

function buildColourGroup(productSeed: number, baseStock: number): VariantGroupDto {
  return {
    id: `grp_${productSeed}_colour`,
    labelEn: 'Colour',
    labelBn: 'রং',
    kind: 'swatch',
    options: SWATCHES.map((swatch, index) => ({
      id: `var_${productSeed}_c${index}`,
      nameEn: swatch.en,
      nameBn: swatch.bn,
      priceDeltaPoisha: 0,
      stock:
        baseStock <= 0 ? 0 : index === 3 && productSeed % 2 === 1 ? 0 : 9,
      swatch: swatch.hex,
    })),
  };
}

// ─── Reviews ──────────────────────────────────────────────────────────────

/**
 * Sample reviews, keyed by a stable product hash.
 *
 * A product gets reviews only when its DTO says `reviewCount > 0`. The bodies
 * below are the reference's five, translated, because they are the only review
 * copy the project has. Products with `reviewCount === 0` get an empty array
 * and the page shows the empty state — never a fabricated rating.
 */
const REVIEW_POOL: Omit<ReviewDto, 'id' | 'createdAt'>[] = [
  {
    authorName: 'Rahim U.',
    rating: 5,
    bodyEn: 'Great quality. Delivered on time and matches the photos.',
    bodyBn: 'দারুণ কোয়ালিটি। ঠিক সময়ে ডেলিভারি পেয়েছি।',
    isVerifiedPurchase: true,
    helpfulCount: 12,
  },
  {
    authorName: 'Nusrat J.',
    rating: 4,
    bodyEn: 'Good value for the price. Packaging could be better.',
    bodyBn: 'দাম অনুযায়ী ভালো। প্যাকেজিং আরও ভালো হতে পারত।',
    isVerifiedPurchase: true,
    helpfulCount: 7,
  },
  {
    authorName: 'Tanvir H.',
    rating: 5,
    bodyEn: 'Genuine product. Will buy again.',
    bodyBn: 'অরিজিনাল পণ্য। আবার কিনব।',
    isVerifiedPurchase: false,
    helpfulCount: 4,
  },
  {
    authorName: 'Sadia A.',
    rating: 3,
    bodyEn: 'Okay. Expected a bit more.',
    bodyBn: 'মোটামুটি। আশা করেছিলাম আরও ভালো।',
    isVerifiedPurchase: true,
    helpfulCount: 2,
  },
  {
    authorName: 'Imran K.',
    rating: 5,
    bodyEn: 'Best purchase this month. Recommended to friends.',
    bodyBn: 'সেরা! বন্ধুদেরও সুপারিশ করেছি।',
    isVerifiedPurchase: true,
    helpfulCount: 9,
  },
];

const REVIEW_DATES = [
  '2026-10-12',
  '2026-10-03',
  '2026-09-28',
  '2026-09-14',
  '2026-09-02',
];

/**
 * MOCK ONLY — these reviews are generated, not real customer data. They must
 * never reach production; the API replaces them.
 *
 * Builds the review sample for a product from `REVIEW_POOL`, keyed by a stable
 * seed. Nothing here is a real customer's words, so nothing here may ship.
 */
function buildReviews(product: ProductDto, seed: number): ReviewDto[] {
  if (product.reviewCount <= 0) return [];

  /**
   * How many of the pool to show: never more than the aggregate claims, and
   * never more than we have. A product with 1,284 ratings shows the same five
   * samples — the count is the aggregate, the list is a sample.
   */
  const count = Math.min(REVIEW_POOL.length, product.reviewCount);

  return REVIEW_POOL.slice(0, count).map((review, index) => ({
    ...review,
    id: `rev_${seed}_${index}`,
    createdAt: `${REVIEW_DATES[index]}T00:00:00.000Z`,
  }));
}

/**
 * Rating histogram. Derived from the product's own average rather than the
 * reference's fixed `{5:64,4:22,3:8,2:4,1:2}`, so a 3.2-rated product does not
 * show a distribution that implies 4.6.
 */
function buildBreakdown(rating: number, reviewCount: number): number[] {
  if (reviewCount <= 0) return [0, 0, 0, 0, 0];

  // Weight each star bucket by how close it is to the average.
  const weights = [5, 4, 3, 2, 1].map((star) => {
    const distance = Math.abs(star - rating);
    return Math.max(0, 1 - distance / 2.5) ** 2;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);

  const percents = weights.map((w) => Math.round((w / total) * 100));

  // Force the sum to 100 by adjusting the largest bucket — a breakdown that
  // adds to 98% looks like a bug to anyone who checks.
  const drift = 100 - percents.reduce((sum, p) => sum + p, 0);
  const largest = percents.indexOf(Math.max(...percents));
  if (largest >= 0) percents[largest] = (percents[largest] ?? 0) + drift;

  return percents;
}

// ─── Specs and features ───────────────────────────────────────────────────

function buildSpecs(product: ProductDto) {
  const rows = [
    {
      labelEn: 'SKU',
      labelBn: 'এসকেইউ',
      valueEn: product.sku,
      valueBn: product.sku,
    },
    {
      labelEn: 'Brand',
      labelBn: 'ব্র্যান্ড',
      valueEn: product.brand?.nameEn ?? '—',
      valueBn: product.brand?.nameBn ?? '—',
    },
    {
      labelEn: 'Category',
      labelBn: 'ক্যাটাগরি',
      valueEn: product.category.nameEn,
      valueBn: product.category.nameBn,
    },
    {
      labelEn: 'Warranty',
      labelBn: 'ওয়ারেন্টি',
      valueEn: product.category.slug === 'gadgets-electronics' ? '12 months' : 'N/A',
      valueBn: product.category.slug === 'gadgets-electronics' ? '১২ মাস' : 'প্রযোজ্য নয়',
    },
    {
      labelEn: 'Origin',
      labelBn: 'উৎস',
      valueEn: 'Bangladesh / Imported',
      valueBn: 'বাংলাদেশ / আমদানি',
    },
  ];
  return rows;
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

// ─── Assembly ─────────────────────────────────────────────────────────────

/**
 * Builds the detail DTO for one product.
 *
 * `baseStock` is the product's own quantity, so a sold-out product produces
 * variant options that are all out of stock rather than a page that offers to
 * sell something it does not have.
 */
export function buildProductDetail(
  product: ProductDto,
  tintColor: string,
  accentColor: string,
): ProductDetailDto {
  // A stable numeric seed from the SKU — same product, same fixtures, always.
  const seed = product.sku
    .split('')
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 7);

  const axis = AXES[product.category.slug];
  const groups: VariantGroupDto[] = [];

  if (axis) {
    groups.push(
      buildGroup(axis, 'button', seed, product.stockQuantity, product.pricePoisha),
    );
  }
  if (COLOUR_CATEGORIES.includes(product.category.slug)) {
    groups.push(buildColourGroup(seed, product.stockQuantity));
  }

  return {
    ...product,
    variantGroups: groups,
    reviews: buildReviews(product, seed),
    ratingBreakdown: buildBreakdown(product.rating, product.reviewCount),
    featuresEn: FEATURES_EN,
    featuresBn: FEATURES_BN,
    specs: buildSpecs(product),
    tintColor,
    accentColor,
  };
}
