import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { AddressesPage } from '@/components/account/addresses-page';
import { RequireAuth } from '@/components/account/require-auth';

export const metadata: Metadata = {
  title: 'My addresses',
  description: `Saved delivery addresses at ${BRAND.name}.`,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <RequireAuth>
      <AddressesPage />
    </RequireAuth>
  );
}
