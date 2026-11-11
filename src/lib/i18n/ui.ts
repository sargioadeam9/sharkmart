/**
 * Component-level strings.
 *
 * `src/lib/i18n/translations/{en,bn}.ts` are GENERATED from the reference's
 * `T` object and must not be hand-edited (see the header in those files).
 * The reference has no string for a few things a typed component needs — a
 * skeleton's aria-label, an "items" suffix on a category card, a close button.
 * They live here instead, in the same shape, so there is still exactly one
 * place per string and still no literal text in a component.
 *
 * Rule: if the reference already has the string, use `t()` and do not add it
 * here. This file is only for gaps.
 */

import type { Lang } from '@/lib/format';
import { localizeNumber } from './index';

export const UI_STRINGS = {
  en: {
    close: 'Close',
    previous: 'Previous',
    next: 'Next',
    items: 'items',
    loading: 'Loading',
    loadingProducts: 'Loading products',
    loadingCategories: 'Loading categories',
    errorTitle: 'Something went wrong',
    errorBody: 'We could not load this section. Please try again.',
    retry: 'Try again',
    emptyCartBody: 'Browse the categories and add something you like.',
    emptyWishlist: 'Your wishlist is empty',
    emptyWishlistBody: 'Tap the heart on any product to save it here.',
    emptyProducts: 'No products to show',
    emptyProductsBody: 'Nothing here yet. Check back soon.',
    suggestions: 'Suggestions',
    products: 'Products',
    categories: 'Categories',
    clearSearch: 'Clear search',
    openCart: 'Open cart',
    removeItem: 'Remove item',
    decreaseQty: 'Decrease quantity',
    increaseQty: 'Increase quantity',
    quantity: 'Quantity',
    addToWishlist: 'Add to wishlist',
    removeFromWishlist: 'Remove from wishlist',
    savedToWishlist: 'Saved to wishlist',
    removedFromWishlist: 'Removed from wishlist',
    viewProduct: 'View product',
    outOfStockShort: 'Out of stock',
    productImage: 'Product image',
    scrollLeft: 'Scroll left',
    scrollRight: 'Scroll right',
    closeSheet: 'Close panel',
    offers: 'Offers',
    of: 'of',
    support: 'Customer support',
    newsletterRequired: 'Please enter your email address.',
    newsletterInvalid: 'That does not look like a valid email address.',
    newsletterThanks: 'Thanks — check your inbox for the welcome code.',
    recentlyViewedEmpty: 'Nothing viewed yet',
    recentlyViewedEmptyBody: 'Products you open will show up here.',
    promoOff: 'off',
  },
  bn: {
    close: 'বন্ধ করুন',
    previous: 'আগের',
    next: 'পরের',
    items: 'পণ্য',
    loading: 'লোড হচ্ছে',
    loadingProducts: 'পণ্য লোড হচ্ছে',
    loadingCategories: 'ক্যাটাগরি লোড হচ্ছে',
    errorTitle: 'কিছু একটা সমস্যা হয়েছে',
    errorBody: 'এই অংশটি লোড করা যায়নি। আবার চেষ্টা করুন।',
    retry: 'আবার চেষ্টা করুন',
    emptyCartBody: 'ক্যাটাগরি দেখুন এবং পছন্দের কিছু যোগ করুন।',
    emptyWishlist: 'আপনার উইশলিস্ট খালি',
    emptyWishlistBody: 'যেকোনো পণ্যের হার্টে চাপ দিয়ে এখানে সংরক্ষণ করুন।',
    emptyProducts: 'দেখানোর মতো কোনো পণ্য নেই',
    emptyProductsBody: 'এখানে এখনো কিছু নেই। শীঘ্রই আবার দেখুন।',
    suggestions: 'পরামর্শ',
    products: 'পণ্য',
    categories: 'ক্যাটাগরি',
    clearSearch: 'সার্চ মুছুন',
    openCart: 'কার্ট খুলুন',
    removeItem: 'পণ্য সরান',
    decreaseQty: 'পরিমাণ কমান',
    increaseQty: 'পরিমাণ বাড়ান',
    quantity: 'পরিমাণ',
    addToWishlist: 'উইশলিস্টে যোগ করুন',
    removeFromWishlist: 'উইশলিস্ট থেকে সরান',
    savedToWishlist: 'উইশলিস্টে সংরক্ষিত',
    removedFromWishlist: 'উইশলিস্ট থেকে সরানো হয়েছে',
    viewProduct: 'পণ্য দেখুন',
    outOfStockShort: 'স্টকে নেই',
    productImage: 'পণ্যের ছবি',
    scrollLeft: 'বাঁয়ে স্ক্রল করুন',
    scrollRight: 'ডানে স্ক্রল করুন',
    closeSheet: 'প্যানেল বন্ধ করুন',
    offers: 'অফার',
    of: 'এর',
    support: 'গ্রাহক সহায়তা',
    newsletterRequired: 'অনুগ্রহ করে আপনার ইমেইল দিন।',
    newsletterInvalid: 'এটি সঠিক ইমেইল ঠিকানা মনে হচ্ছে না।',
    newsletterThanks: 'ধন্যবাদ — স্বাগত কোডের জন্য ইনবক্স দেখুন।',
    recentlyViewedEmpty: 'এখনো কিছু দেখা হয়নি',
    recentlyViewedEmptyBody: 'আপনি যে পণ্যগুলো খুলবেন সেগুলো এখানে দেখা যাবে।',
    promoOff: 'ছাড়',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type UiKey = keyof (typeof UI_STRINGS)['en'];

export function tUi(lang: Lang, key: UiKey, vars?: Record<string, string | number>): string {
  const dict = UI_STRINGS[lang] ?? UI_STRINGS.en;
  let out: string = dict[key] ?? UI_STRINGS.en[key] ?? key;

  if (vars) {
    for (const [name, raw] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, localizeNumber(raw, lang));
    }
  }

  return out;
}
