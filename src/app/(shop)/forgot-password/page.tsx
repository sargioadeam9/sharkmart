import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { AuthShell } from '@/components/account/auth-shell';
import { ForgotPasswordForm } from '@/components/account/forgot-password-form';

/**
 * `/forgot-password` — where the sign-in form's "Forgot password?" link lands.
 *
 * It has existed as a link since the auth surface was built; the page did not,
 * so the one route a locked-out customer needs was the one route that 404'd.
 *
 * `noindex, nofollow`: an auth form has no search value, and an indexed
 * password-reset page is a phishing template's favourite starting point.
 */

export const metadata: Metadata = {
  title: 'Reset your password',
  description: `Request a password reset link for your ${BRAND.name} account.`,
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell titleKey="forgotTitle" subtitleKey="forgotSubtitle">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
