import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { CartPage } from '@/components/account/cart-page';

/**
 * `/cart`.
 *
 * A thin server shell: the cart is per-visitor state (localStorage or the
 * session cookie), so there is nothing to prerender. `noindex` because a
 * personal cart has no search value.
 */

export const metadata: Metadata = {
  title: 'Shopping cart',
  description: `Your cart at ${BRAND.name}.`,
  robots: { index: false, follow: true },
};

export default function Page() {
  return <CartPage />;
}
