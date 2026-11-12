import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { OrderDetailPage } from '@/components/account/order-detail-page';
import { RequireAuth } from '@/components/account/require-auth';

/**
 * `/orders/[id]`.
 *
 * The id is the internal order id, not the order number — and the server checks
 * ownership on it (IDOR gate item). A signed-in user opening someone else's id
 * gets a 404, which this page renders as "not found" rather than an error.
 */

export const metadata: Metadata = {
  title: 'Order details',
  description: `Order details at ${BRAND.name}.`,
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RequireAuth>
      <OrderDetailPage orderId={id} />
    </RequireAuth>
  );
}
