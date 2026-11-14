'use client';

/**
 * The second half of the reset flow: `/reset-password?token=…`.
 *
 * The token arrives in the query string, which means it is in the browser's
 * history and in any referrer this page sends. Two consequences:
 *
 *  - Nothing on this page may load a third-party resource. It does not.
 *  - The token is consumed on the first successful submit — the API marks it
 *    used and revokes every session — so a leaked URL is dead by the time
 *    anyone else opens it.
 *
 * The password rules are the same `checkPassword` the register form uses, so a
 * password that is accepted at sign-up is accepted here and vice versa.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';

import { useLang } from '@/lib/hooks';
import { resetPassword } from '@/lib/api/account';
import { checkPassword } from '@/lib/account-validation';
import { Field, FormAlert } from '@/components/account/form-fields';

export function ResetPasswordForm({ token }: { token: string }) {
  const { tu } = useLang();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      const next: { password?: string; confirm?: string } = {};
      if (!checkPassword(password).valid) next.password = tu('passwordWeak');
      if (password !== confirm) next.confirm = tu('passwordMismatch');

      setErrors(next);
      if (Object.keys(next).length > 0) return;

      setSubmitting(true);
      try {
        await resetPassword(token, password);
        setDone(true);
      } catch (error) {
        /**
         * A 422 here is the token, not the password: it expired, was already
         * used, or never existed. The server's message says which, and it is
         * written for a human, so it is shown as-is rather than flattened into
         * "something went wrong".
         */
        setFormError(messageFor(error, tu));
      } finally {
        setSubmitting(false);
      }
    },
    [password, confirm, token, tu],
  );

  if (done) {
    return (
      <div className="acct-form">
        <FormAlert tone="success">{tu('resetDone')}</FormAlert>
        <Link href="/login" className="btn red acct-submit">
          {tu('backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form className="acct-form" onSubmit={handleSubmit} noValidate>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}

      <Field
        label={tu('newPassword')}
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="new-password"
        hint={tu('passwordWeak')}
        revealable
        showLabel={tu('showPassword')}
        hideLabel={tu('hidePassword')}
        error={errors.password}
        required
      />

      <Field
        label={tu('confirmPassword')}
        value={confirm}
        onChange={setConfirm}
        type="password"
        autoComplete="new-password"
        error={errors.confirm}
        required
      />

      <button type="submit" className="btn red acct-submit" disabled={submitting}>
        {submitting ? tu('loading') : tu('resetPassword')}
      </button>

      <p className="acct-switch">
        <Link href="/forgot-password" className="acct-link">
          {tu('sendResetLink')}
        </Link>
      </p>
    </form>
  );
}

function messageFor(error: unknown, tu: (key: 'rateLimited' | 'genericAuthError') => string): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    if (status === 429) return tu('rateLimited');
  }

  const message = (error as { message?: unknown })?.message;
  if (typeof message === 'string' && message.trim().length > 0) return message;

  return tu('genericAuthError');
}

/**
 * What `/reset-password` shows when the URL has no `?token=`.
 *
 * A live component rather than server-rendered text because the message is
 * bilingual and the language lives in the same store the rest of the auth
 * surface reads. It offers the one useful action — ask for a new link — instead
 * of an empty password form that cannot succeed.
 */
export function ResetLinkMissing() {
  const { tu } = useLang();

  return (
    <div className="acct-form">
      <FormAlert tone="info">{tu('resetTokenMissing')}</FormAlert>
      <Link href="/forgot-password" className="btn red acct-submit">
        {tu('sendResetLink')}
      </Link>
    </div>
  );
}
