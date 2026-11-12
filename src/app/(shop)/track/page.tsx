import type { Metadata } from 'next';
import { Suspense } from 'react';

import { BRAND } from '@/lib/brand';
import { TrackPage } from '@/components/account/track-page';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * `/track`.
 *
 * Public — no session required, because the whole point is that a shopper who
 * checked out as a guest can still find their order. `useSearchParams` needs a
 * Suspense boundary for static rendering.
 */

export const metadata: Metadata = {
  title: 'Track order',
  description: `Track your ${BRAND.name} order with your order number and phone.`,
  robots: { index: true, follow: true },
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="wrap acct-page" aria-busy="true">
          <Skeleton className="mx-auto h-[280px] w-full max-w-[620px]" />
        </div>
      }
    >
      <TrackPage />
    </Suspense>
  );
}
