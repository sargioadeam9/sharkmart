import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { OrdersPage } from '@/components/account/orders-page';
import { RequireAuth } from '@/components/account/require-auth';

export const metadata: Metadata = {
  title: 'My orders',
  description: `Your order history at ${BRAND.name}.`,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <RequireAuth>
      <OrdersPage />
    </RequireAuth>
  );
}
