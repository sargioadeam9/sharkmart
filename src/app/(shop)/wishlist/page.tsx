import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { WishlistPage } from '@/components/wishlist/wishlist-page';

/**
 * `/wishlist` — guest wishlist.
 *
 * The list lives in localStorage, so there is nothing to load on the server and
 * nothing to prerender: the route is a thin shell around a client component that
 * reads the store after hydration. That is why this page has no `initialData` —
 * unlike `/search` and `/category/[slug]`, the data genuinely does not exist
 * until the browser provides it.
 *
 * `noindex`: a personal list has no search value and must not be indexed.
 */

export const metadata: Metadata = {
  title: 'Wishlist',
  description: `Products you saved at ${BRAND.name}.`,
  robots: { index: false, follow: true },
};

export default function Page() {
  return <WishlistPage />;
}
