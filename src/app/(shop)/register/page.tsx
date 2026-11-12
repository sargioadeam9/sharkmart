import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { RegisterForm } from '@/components/account/register-form';
import { safeNext } from '@/lib/safe-next';
import { AuthShell } from '@/components/account/auth-shell';

/**
 * `/register`.
 *
 * `noindex`, same reasoning as `/login`.
 */

export const metadata: Metadata = {
  title: 'Create account',
  description: `Create a ${BRAND.name} account to track orders and check out faster.`,
  robots: { index: false, follow: false },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell titleKey="registerTitle" subtitleKey="registerSubtitle">
      <RegisterForm next={safeNext(params.next)} />
    </AuthShell>
  );
}
