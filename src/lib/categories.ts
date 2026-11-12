import { BRAND } from './brand';

/**
 * The 14 storefront categories.
 *
 * Every value here is copied from the `CATS` array in oshoppingbd.html
 * (line 540). Do not retype ids from prose — a wrong slug silently breaks
 * /category/[slug], the mega menu and the sitemap.
 *
 * NOTE: the reference prefixes its house brands with "O" (OFashion, OBeauty, …).
 * SharkMart drops the prefix, so each house brand reads as a plain noun
 * (Fashion, Beauty, …). The rename lives in tools/extract-reference.mjs, so the
 * generated catalog, the brand slugs and these values cannot drift apart.
 */

export interface Category {
  id: string;
  nameEn: string;
  nameBn: string;
  /** Accent colour — used for borders, icons, promo panels. */
  accent: string;
  /** Light tint — used for icon tiles and section backgrounds. */
  tint: string;
  emoji: string;
  houseBrand: string;
}

export const CATEGORIES: readonly Category[] = [
  {
    id: 'fashion',
    nameEn: 'Fashion',
    nameBn: 'ফ্যাশন',
    accent: '#D9B99B',
    tint: '#F4E9DD',
    emoji: '👗',
    houseBrand: 'Fashion',
  },
  {
    id: 'kids-baby',
    nameEn: 'Kids & Baby',
    nameBn: 'শিশু ও বেবি',
    accent: '#E9A9BC',
    tint: '#FBEAF0',
    emoji: '🧸',
    houseBrand: BRAND.name,
  },
  {
    id: 'beauty-care',
    nameEn: 'Beauty & Care',
    nameBn: 'বিউটি ও কেয়ার',
    accent: '#D8B6C6',
    tint: '#F5EAF0',
    emoji: '💄',
    houseBrand: 'Beauty',
  },
  {
    id: 'perfumes-fragrance',
    nameEn: 'Perfumes & Fragrance',
    nameBn: 'পারফিউম ও ফ্র্যাগরেন্স',
    accent: '#B89A72',
    tint: '#F1E9DB',
    emoji: '🌸',
    houseBrand: 'Fragrance',
  },
  {
    id: 'gadgets-electronics',
    nameEn: 'Gadgets & Electronics',
    nameBn: 'গ্যাজেট ও ইলেকট্রনিক্স',
    accent: '#6386B6',
    tint: '#E7EFF9',
    emoji: '📱',
    houseBrand: 'Gadgets',
  },
  {
    id: 'herbal-natural',
    nameEn: 'Herbal & Natural',
    nameBn: 'হার্বাল ও ন্যাচারাল',
    accent: '#668B55',
    tint: '#E8F0E3',
    emoji: '🌿',
    houseBrand: 'Nature',
  },
  {
    id: 'home-kitchen',
    nameEn: 'Home & Kitchen',
    nameBn: 'হোম ও কিচেন',
    accent: '#B89A7A',
    tint: '#F0E7DD',
    emoji: '🍳',
    houseBrand: 'Home',
  },
  {
    id: 'food-grocery',
    nameEn: 'Food & Grocery',
    nameBn: 'খাবার ও গ্রোসারি',
    accent: '#D9A441',
    tint: '#FBF0D9',
    emoji: '🛒',
    houseBrand: 'Food',
  },
  {
    id: 'books-education',
    nameEn: 'Books & Education',
    nameBn: 'বই ও শিক্ষা',
    accent: '#6C82A0',
    tint: '#E9EEF5',
    emoji: '📚',
    houseBrand: 'Books',
  },
  {
    id: 'automotive-motorbike',
    nameEn: 'Automotive & Motorbike',
    nameBn: 'অটোমোটিভ ও মোটরবাইক',
    accent: '#58616C',
    tint: '#E9ECEF',
    emoji: '🏍️',
    houseBrand: BRAND.name,
  },
  {
    id: 'sports-fitness-outdoors',
    nameEn: 'Sports, Fitness & Outdoors',
    nameBn: 'স্পোর্টস, ফিটনেস ও আউটডোর',
    accent: '#3C8A70',
    tint: '#E1F1EA',
    emoji: '⚽',
    houseBrand: BRAND.name,
  },
  {
    id: 'pet-supplies',
    nameEn: 'Pet Supplies',
    nameBn: 'পোষা প্রাণীর সামগ্রী',
    accent: '#C9956B',
    tint: '#F7EADF',
    emoji: '🐾',
    houseBrand: BRAND.name,
  },
  {
    id: 'office-business',
    nameEn: 'Office & Business Supplies',
    nameBn: 'অফিস ও ব্যবসায়িক সামগ্রী',
    accent: '#687C91',
    tint: '#E8EDF3',
    emoji: '🗂️',
    houseBrand: BRAND.name,
  },
  {
    id: 'garden-plants',
    nameEn: 'Garden & Plants',
    nameBn: 'বাগান ও গাছ',
    accent: '#4F8050',
    tint: '#E5F0E2',
    emoji: '🪴',
    houseBrand: 'Nature',
  },
];

export const CATEGORY_BY_ID: ReadonlyMap<string, Category> = new Map(
  CATEGORIES.map((category) => [category.id, category]),
);

export const CATEGORY_IDS: readonly string[] = CATEGORIES.map((c) => c.id);

export function getCategory(id: string): Category | undefined {
  return CATEGORY_BY_ID.get(id);
}

export function categoryName(category: Category, lang: 'en' | 'bn'): string {
  return lang === 'bn' ? category.nameBn : category.nameEn;
}
