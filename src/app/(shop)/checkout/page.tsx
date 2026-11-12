import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { CheckoutPage } from '@/components/account/checkout-page';

/**
 * `/checkout`.
 *
 * `noindex` and `nofollow`: a checkout page in a search index is a page a
 * shopper can land on with an empty cart, and it tells a competitor nothing
 * useful but tells a crawler everything about the flow.
 */

export const metadata: Metadata = {
  title: 'Checkout',
  description: `Complete your order at ${BRAND.name}.`,
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CheckoutPage />;
}
