/**
 * Phase 0 gate proof.
 *
 * Exercises the pieces the gate names — i18n in both locales, money formatting,
 * the mock layer's contract shape, and the 14 category ids — and prints real
 * values so the handoff can quote them instead of claiming them.
 *
 * Run: npx tsx tools/verify-phase0.ts
 */

import { t, toBanglaDigits, localizeNumber } from '../src/lib/i18n/index.js';
import { formatMoney, formatMoneyAdmin } from '../src/lib/format.js';
import {
  MOCK_CATEGORIES,
  MOCK_BRANDS,
  MOCK_PRODUCTS,
  mockListProducts,
  mockHomepage,
} from '../src/lib/mock/index.js';
import { FREE_DELIVERY_THRESHOLD_POISHA, deliveryFeePoisha } from '../src/lib/commerce.js';
import { BRAND } from '../src/lib/brand.js';

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${mark}] ${label}: ${detail}`);
}

console.log('=== brand ===');
check('BRAND.name', BRAND.name === 'SharkMart', BRAND.name);
check('BRAND.tagline', BRAND.tagline === 'Fast Delivery', BRAND.tagline);
check('BRAND.domain', BRAND.domain === 'sharkmart.com.bd', BRAND.domain);

console.log('\n=== i18n ===');
const enAdd = t('en', 'add');
const bnAdd = t('bn', 'add');
check('t(en, add)', enAdd === 'Add to Cart', enAdd);
check('t(bn, add)', bnAdd === 'কার্টে যোগ করুন', bnAdd);

const bnLeft = t('bn', 'left', { n: 4 });
check('t(bn, left, {n:4})', bnLeft === 'মাত্র ৪টি বাকি', bnLeft);

const enShowing = t('en', 'showing', { a: 20, b: 168 });
check('t(en, showing)', enShowing === 'Showing 20 of 168 products', enShowing);

const bnShowing = t('bn', 'showing', { a: 20, b: 168 });
check('t(bn, showing)', bnShowing.includes('২০') && bnShowing.includes('১৬৮'), bnShowing);

check('toBanglaDigits', toBanglaDigits('2026') === '২০২৬', toBanglaDigits('2026'));
check('localizeNumber(en)', localizeNumber(2000, 'en') === '2,000', localizeNumber(2000, 'en'));

console.log('\n=== money (integer poisha) ===');
check('formatMoney(en, 189000)', formatMoney(189000, 'en') === '৳1,890', formatMoney(189000, 'en'));
check('formatMoney(bn, 189000)', formatMoney(189000, 'bn') === '৳১,৮৯০', formatMoney(189000, 'bn'));
check('formatMoneyAdmin(48235000)', formatMoneyAdmin(48235000) === '৳4,82,350', formatMoneyAdmin(48235000));

console.log('\n=== delivery rules ===');
check('threshold', FREE_DELIVERY_THRESHOLD_POISHA === 200000, String(FREE_DELIVERY_THRESHOLD_POISHA));
check('fee below threshold', deliveryFeePoisha(199900) === 6000, String(deliveryFeePoisha(199900)));
check('fee at threshold', deliveryFeePoisha(200000) === 0, String(deliveryFeePoisha(200000)));
check('fee on empty cart', deliveryFeePoisha(0) === 0, String(deliveryFeePoisha(0)));

console.log('\n=== catalog ===');
check('14 categories', MOCK_CATEGORIES.length === 14, String(MOCK_CATEGORIES.length));

const EXPECTED_IDS = [
  'fashion',
  'kids-baby',
  'beauty-care',
  'perfumes-fragrance',
  'gadgets-electronics',
  'herbal-natural',
  'home-kitchen',
  'food-grocery',
  'books-education',
  'automotive-motorbike',
  'sports-fitness-outdoors',
  'pet-supplies',
  'office-business',
  'garden-plants',
];
const actualIds = MOCK_CATEGORIES.map((c) => c.slug);
check(
  'category ids match reference exactly',
  JSON.stringify(actualIds) === JSON.stringify(EXPECTED_IDS),
  actualIds.join(','),
);
check(
  'office-business (not office-business-supplies)',
  actualIds.includes('office-business') && !actualIds.includes('office-business-supplies'),
  'ok',
);

check('brands', MOCK_BRANDS.length === 25, String(MOCK_BRANDS.length));
check(
  'own brands = 9',
  MOCK_BRANDS.filter((b) => b.isOwnBrand).length === 9,
  String(MOCK_BRANDS.filter((b) => b.isOwnBrand).length),
);
check('products', MOCK_PRODUCTS.length === 168, String(MOCK_PRODUCTS.length));

console.log('\n=== contract shape ===');
const first = MOCK_PRODUCTS[0];
if (!first) throw new Error('no products in mock');

check('money is integer poisha', Number.isInteger(first.pricePoisha), String(first.pricePoisha));
check('bilingual pair present', Boolean(first.nameEn && first.nameBn), `${first.nameEn} / ${first.nameBn}`);
check('no bare `name` field', !('name' in first), 'ok');
check('stockStatus is a union member', ['in_stock', 'low_stock', 'out_of_stock'].includes(first.stockStatus), first.stockStatus);
check('category ref is flat', typeof first.category.slug === 'string', first.category.slug);

const page = mockListProducts({ page: 2, limit: 10 });
check('envelope success', page.success === true, 'true');
check('meta.page', page.meta?.page === 2, String(page.meta?.page));
check('meta.limit', page.meta?.limit === 10, String(page.meta?.limit));
check('meta.total', page.meta?.total === 168, String(page.meta?.total));
check('page size honoured', page.data.length === 10, String(page.data.length));

const filtered = mockListProducts({ category: 'gadgets-electronics', limit: 100 });
check(
  'category filter',
  filtered.data.every((p) => p.category.slug === 'gadgets-electronics'),
  `${filtered.data.length} products`,
);

const searched = mockListProducts({ q: 'watch', limit: 100 });
check('search finds results', searched.data.length > 0, `${searched.data.length} hits`);

const home = mockHomepage();
check('homepage aggregate', home.success === true, `flashSale=${home.data.flashSale.length}, bestSellers=${home.data.bestSellers.length}`);
check('homepage carries 14 categories', home.data.categories.length === 14, String(home.data.categories.length));
check(
  'homepage threshold matches commerce rule',
  home.data.freeDeliveryThresholdPoisha === FREE_DELIVERY_THRESHOLD_POISHA,
  String(home.data.freeDeliveryThresholdPoisha),
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
