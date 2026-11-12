import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { ProfilePage } from '@/components/account/profile-page';
import { RequireAuth } from '@/components/account/require-auth';

/**
 * `/profile` — gated by `RequireAuth`.
 *
 * The gate is UX only: every endpoint this page calls returns 401 without a
 * valid session, so the API is the real boundary.
 */

export const metadata: Metadata = {
  title: 'My account',
  description: `Your ${BRAND.name} account.`,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <RequireAuth>
      <ProfilePage />
    </RequireAuth>
  );
}
