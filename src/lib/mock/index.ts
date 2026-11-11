/**
 * Mock layer — the bridge that lets frontend phases build before the API
 * exists, with zero component changes when it flips off.
 *
 * The switch is one env var: `NEXT_PUBLIC_USE_MOCK=true`.
 *
 *   Phase 1–5  : USE_MOCK=true, components read fixtures shaped exactly like
 *                the contract in src/types.
 *   Phase 6+   : USE_MOCK=false, the same components read the real API.
 *
 * The fixtures are NOT invented. They are generated from the frozen reference
 * (oshoppingbd.html) by tools/extract-reference.mjs, so the mock data and the
 * seeded database are the same catalog. That is what makes the flip safe.
 */

import rawCatalog from '../../../data/reference-catalog.json';
import type {
  BrandDto,
  CategoryDto,
  ProductDto,
  ProductListQuery,
  ProductBadge,
  StockStatus,
  SubcategoryDto,
} from '@/types/catalog';
import type { ApiMeta, ApiSuccess } from '@/types/api';
import { FREE_DELIVERY_THRESHOLD_POISHA } from '@/lib/commerce';

// ─── Raw reference shape ──────────────────────────────────────────────────

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

const catalog = rawCatalog as unknown as RawCatalog;

// ─── Deterministic ids ────────────────────────────────────────────────────
// Stable, readable ids so a mock product and its seeded row share an identity.
// `cat_fashion`, `brd_sharkmart`, `prd_osb-1001`.

const catId = (slug: string) => `cat_${slug}`;
const brandId = (slug: string) => `brd_${slug}`;
const productId = (sku: string) => `prd_${sku.toLowerCase()}`;

// ─── Mapping helpers ──────────────────────────────────────────────────────

const takaToPoisha = (taka: number) => Math.round(taka * 100);

function stockStatusOf(quantity: number): StockStatus {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= 5) return 'low_stock';
  return 'in_stock';
}

/**
 * The reference has no image assets — it renders an emoji on a category-tinted
 * tile. We mirror that so Phase 1 cards have something real to lay out, and
 * mark the URL as a placeholder rather than pretending a photo exists.
 */
function placeholderImageUrl(emoji: string, tint: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${tint}"/><text x="50%" y="50%" font-size="260" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const categoryBySlug = new Map(catalog.categories.map((c) => [c.slug, c]));
const brandBySlug = new Map(catalog.brands.map((b) => [b.slug, b]));

function badgesFor(p: RawProduct): ProductBadge[] {
  const badges: ProductBadge[] = [];
  if (p.discountPercent > 0) badges.push('sale');
  if (p.refId <= 14) badges.push('new');
  if (p.reviewCount > 300) badges.push('bestseller');
  if (p.sold > 70) badges.push('trending');
  return badges;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

export const MOCK_CATEGORIES: CategoryDto[] = catalog.categories.map((c) => {
  const products = catalog.products.filter((p) => p.categoryId === c.slug);
  const subcategories: SubcategoryDto[] = c.subcategories.map((s, i) => ({
    id: `sub_${s.slug}`,
    slug: s.slug,
    nameEn: s.nameEn,
    nameBn: s.nameBn,
    productCount: products.filter((p) => p.index % c.subcategories.length === i).length,
  }));

  return {
    id: catId(c.slug),
    slug: c.slug,
    nameEn: c.nameEn,
    nameBn: c.nameBn,
    accentColor: c.accentColor,
    lightTintColor: c.lightTintColor,
    iconEmoji: c.iconEmoji,
    sortOrder: c.sortOrder,
    productCount: products.length,
    subcategories,
  };
});

export const MOCK_BRANDS: BrandDto[] = catalog.brands.map((b, index) => ({
  id: brandId(b.slug),
  slug: b.slug,
  nameEn: b.nameEn,
  nameBn: b.nameBn,
  logo: null,
  taglineEn: b.taglineEn,
  taglineBn: b.taglineBn,
  color: b.color,
  isOwnBrand: b.isOwnBrand,
  sortOrder: index,
  productCount: catalog.products.filter((p) => p.brandSlug === b.slug).length,
}));

export const MOCK_PRODUCTS: ProductDto[] = catalog.products.map((p) => {
  const category = categoryBySlug.get(p.categoryId);
  const brand = brandBySlug.get(p.brandSlug);
  if (!category) throw new Error(`mock: unknown category ${p.categoryId}`);

  const pricePoisha = takaToPoisha(p.priceTaka);
  const originalPricePoisha = takaToPoisha(p.originalPriceTaka);
  const tint = category.lightTintColor;

  return {
    id: productId(p.sku),
    slug: p.sku.toLowerCase(),
    sku: p.sku,

    nameEn: p.nameEn,
    nameBn: p.nameBn,
    descriptionEn: `${p.nameEn} — ${category.nameEn}. ${brand?.taglineEn ?? ''}`.trim(),
    descriptionBn: `${p.nameBn} — ${category.nameBn}। ${brand?.taglineBn ?? ''}`.trim(),

    category: {
      id: catId(category.slug),
      slug: category.slug,
      nameEn: category.nameEn,
      nameBn: category.nameBn,
    },
    brand: brand
      ? {
          id: brandId(brand.slug),
          slug: brand.slug,
          nameEn: brand.nameEn,
          nameBn: brand.nameBn,
          color: brand.color,
        }
      : null,

    pricePoisha,
    originalPricePoisha,
    discountPercent: p.discountPercent,

    images: [
      {
        id: `img_${p.sku}_1`,
        url: placeholderImageUrl(p.emoji, tint),
        altEn: p.nameEn,
        altBn: p.nameBn,
        isMain: true,
        sortOrder: 0,
      },
    ],
    variants: [],

    rating: p.rating,
    reviewCount: p.reviewCount,

    stockStatus: stockStatusOf(p.stock),
    stockQuantity: p.stock,

    isFeatured: p.refId <= 14,
    isFlashSale: p.discountPercent >= 30,
    flashSalePricePoisha: p.discountPercent >= 30 ? pricePoisha : null,
    flashSaleEndsAt: null,

    badges: badgesFor(p),

    createdAt: `2026-10-${String((p.refId % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
});

// ─── Query functions — same signatures the real API client will expose ────

function paginate<T>(items: T[], page: number, limit: number): { slice: T[]; meta: ApiMeta } {
  const total = items.length;
  const start = (page - 1) * limit;
  return {
    slice: items.slice(start, start + limit),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export function mockListProducts(
  query: ProductListQuery = {},
): ApiSuccess<ProductDto[]> {
  const {
    page = 1,
    limit = 20,
    category,
    brand,
    q,
    minPricePoisha,
    maxPricePoisha,
    inStockOnly,
    onDiscountOnly,
    sort = 'relevance',
  } = query;

  let items = [...MOCK_PRODUCTS];

  if (category) items = items.filter((p) => p.category.slug === category);
  if (brand) items = items.filter((p) => p.brand?.slug === brand);
  if (inStockOnly) items = items.filter((p) => p.stockStatus !== 'out_of_stock');
  if (onDiscountOnly) items = items.filter((p) => p.discountPercent > 0);
  if (minPricePoisha !== undefined) items = items.filter((p) => p.pricePoisha >= minPricePoisha);
  if (maxPricePoisha !== undefined) items = items.filter((p) => p.pricePoisha <= maxPricePoisha);

  if (q) {
    const needle = q.trim().toLowerCase();
    items = items.filter((p) => {
      const haystack = [p.nameEn, p.nameBn, p.sku, p.brand?.nameEn ?? '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  switch (sort) {
    case 'newest':
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case 'popular':
      items.sort((a, b) => b.reviewCount - a.reviewCount);
      break;
    case 'price_asc':
      items.sort((a, b) => a.pricePoisha - b.pricePoisha);
      break;
    case 'price_desc':
      items.sort((a, b) => b.pricePoisha - a.pricePoisha);
      break;
    case 'rating':
      items.sort((a, b) => b.rating - a.rating);
      break;
    default:
      break;
  }

  const { slice, meta } = paginate(items, page, limit);
  return { success: true, data: slice, meta };
}

export function mockGetProduct(slug: string): ProductDto | undefined {
  return MOCK_PRODUCTS.find((p) => p.slug === slug);
}

export function mockListCategories(): ApiSuccess<CategoryDto[]> {
  return {
    success: true,
    data: MOCK_CATEGORIES,
    meta: { page: 1, limit: MOCK_CATEGORIES.length, total: MOCK_CATEGORIES.length },
  };
}

export function mockGetCategory(slug: string): CategoryDto | undefined {
  return MOCK_CATEGORIES.find((c) => c.slug === slug);
}

export function mockListBrands(): ApiSuccess<BrandDto[]> {
  return {
    success: true,
    data: MOCK_BRANDS,
    meta: { page: 1, limit: MOCK_BRANDS.length, total: MOCK_BRANDS.length },
  };
}

export function mockGetBrand(slug: string): BrandDto | undefined {
  return MOCK_BRANDS.find((b) => b.slug === slug);
}

/**
 * The homepage aggregate — the one endpoint Phase 3 needs. Shape is frozen
 * here so Phase 6 implements it rather than inventing it.
 */
export interface HomepageAggregate {
  flashSale: ProductDto[];
  featured: ProductDto[];
  newArrivals: ProductDto[];
  bestSellers: ProductDto[];
  trending: ProductDto[];
  /** "Only for You" — a different slice from trending, as in the reference. */
  onlyForYou: ProductDto[];
  /** "Recommended for You". */
  recommended: ProductDto[];
  /** "Popular Products" — the reference's `pick(53, 14, p => p.rv > 150)`. */
  popular: ProductDto[];
  categories: CategoryDto[];
  ownBrands: BrandDto[];
  externalBrands: BrandDto[];
  /**
   * The full in-stock catalog, for rails that resolve stored ids rather than
   * render a fixed slice (recently viewed). Without it, a product the user
   * viewed but that is not in one of the fourteen-item rails would silently
   * vanish from the rail.
   */
  catalog: ProductDto[];
  /** The three promo cards; category-derived so their accent is real data. */
  promos: HomepagePromo[];
  /** Flash sale end, ISO — the countdown target. */
  flashSaleEndsAt: string;
  freeDeliveryThresholdPoisha: number;
}

/**
 * A promo banner. The reference hardcodes three `[categoryId, en, bn]` triples
 * and reads the accent off the category; the same three live here as data so
 * the component never inlines them.
 */
export interface HomepagePromo {
  /** Matches `CategoryDto.slug` — the id is `cat_<slug>`, so slug is the key. */
  categorySlug: string;
  headlineEn: string;
  headlineBn: string;
  kickerEn: string;
  kickerBn: string;
}

export function mockHomepage(): ApiSuccess<HomepageAggregate> {
  const inStock = MOCK_PRODUCTS.filter((p) => p.stockStatus !== 'out_of_stock');
  const byReviews = [...inStock].sort((a, b) => b.reviewCount - a.reviewCount);

  /**
   * The reference's `pick(seed, n)` sorts by `(id * seed) % 97`, which gives a
   * stable pseudo-random slice per seed. Same formula, so the rails look like
   * the reference's rather than five copies of the same list.
   */
  const pick = (seed: number, n: number, filter?: (p: ProductDto) => boolean) =>
    inStock
      .filter((p) => !filter || filter(p))
      .sort((a, b) => (Number(a.id) * seed) % 97 - (Number(b.id) * seed) % 97)
      .slice(0, n);

  return {
    success: true,
    data: {
      flashSale: inStock.filter((p) => p.isFlashSale).slice(0, 14),
      featured: inStock.filter((p) => p.isFeatured).slice(0, 14),
      newArrivals: [...inStock].reverse().slice(0, 14),
      bestSellers: byReviews.slice(0, 14),
      trending: inStock.filter((p) => p.badges.includes('trending')).slice(0, 14),
      onlyForYou: pick(11, 14),
      recommended: pick(41, 14),
      popular: pick(53, 14, (p) => p.reviewCount > 150),
      categories: MOCK_CATEGORIES,
      ownBrands: MOCK_BRANDS.filter((b) => b.isOwnBrand),
      /**
       * The reference's `EXT` is a curated list of exactly 12 partner brands
       * (oshoppingbd.html L567), not "every brand that appears on a product".
       * The catalog carries 16 external brands because products reference
       * four more; the rail shows the reference's 12, in its order, so the
       * carousel has the same length and rhythm as the design.
       */
      externalBrands: MOCK_BRANDS.filter((b) => !b.isOwnBrand).slice(0, 12),
      catalog: inStock,
      promos: [
        {
          categorySlug: 'fashion',
          kickerEn: 'Up to 40% off',
          kickerBn: '৪০% পর্যন্ত ছাড়',
          headlineEn: 'Fashion that fits your season',
          headlineBn: 'আপনার মৌসুমের সেরা ফ্যাশন',
        },
        {
          categorySlug: 'gadgets-electronics',
          kickerEn: 'Smart deals',
          kickerBn: 'স্মার্ট ডিল',
          headlineEn: 'Gadgets worth the upgrade',
          headlineBn: 'আপগ্রেডের যোগ্য গ্যাজেট',
        },
        {
          categorySlug: 'herbal-natural',
          kickerEn: '100% pure',
          kickerBn: '১০০% খাঁটি',
          headlineEn: 'Straight from nature',
          headlineBn: 'প্রকৃতি থেকে সরাসরি',
        },
      ],
      flashSaleEndsAt: new Date(Date.now() + (8 * 3600 + 24 * 60 + 36) * 1000).toISOString(),
      freeDeliveryThresholdPoisha: FREE_DELIVERY_THRESHOLD_POISHA,
    },
  };
}
