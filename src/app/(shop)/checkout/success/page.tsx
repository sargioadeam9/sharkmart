import type { Metadata } from 'next';
import { Suspense } from 'react';

import { BRAND } from '@/lib/brand';
import { CheckoutSuccess } from '@/components/account/checkout-success';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * `/checkout/success`.
 *
 * `useSearchParams` forces a client boundary, so the component is wrapped in
 * `Suspense` — without it the whole route opts out of static rendering and
 * `next build` fails the page with a missing-suspense-boundary error.
 */

export const metadata: Metadata = {
  title: 'Order placed',
  description: `Your order at ${BRAND.name}.`,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="wrap acct-page" aria-busy="true">
          <Skeleton className="mx-auto h-[240px] w-full max-w-[620px]" />
        </div>
      }
    >
      <CheckoutSuccess />
    </Suspense>
  );
}
