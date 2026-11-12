import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { LoginForm } from '@/components/account/login-form';
import { safeNext } from '@/lib/safe-next';
import { AuthShell } from '@/components/account/auth-shell';

/**
 * `/login`.
 *
 * `noindex`: an auth form has no search value, and an indexed login page is a
 * phishing target's favourite thing to clone.
 *
 * `searchParams` is a Promise in Next 15+, so the page is async and awaits it.
 * `next` is passed through `safeNext` before it reaches the form — the form
 * re-checks it too, because a redirect target is exactly the kind of value that
 * must never be trusted once, let alone twice.
 */

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to your ${BRAND.name} account.`,
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell titleKey="loginTitle" subtitleKey="loginSubtitle">
      <LoginForm next={safeNext(params.next)} />
    </AuthShell>
  );
}
