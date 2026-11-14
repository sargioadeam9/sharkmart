import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { AuthShell } from '@/components/account/auth-shell';
import { ResetLinkMissing, ResetPasswordForm } from '@/components/account/reset-password-form';

/**
 * `/reset-password?token=…` — the other end of the reset link.
 *
 * `searchParams` is a Promise in Next 15+, so the page awaits it. The token is
 * validated for *presence* here and for validity by the API on submit: a
 * front-end check cannot know whether a token has expired or been used, and
 * pretending otherwise would replace a precise server message with a guess.
 *
 * `noindex, nofollow` for the same reason as `/forgot-password` — and one more:
 * a token in a URL must never be crawled.
 */

export const metadata: Metadata = {
  title: 'Choose a new password',
  description: `Set a new password for your ${BRAND.name} account.`,
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token.trim() : '';

  return (
    <AuthShell titleKey="resetTitle" subtitleKey="resetSubtitle">
      {token ? <ResetPasswordForm token={token} /> : <ResetLinkMissing />}
    </AuthShell>
  );
}
