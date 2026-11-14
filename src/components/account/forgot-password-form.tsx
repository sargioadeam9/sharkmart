'use client';

/**
 * "Send me a reset link" — the form behind `/forgot-password`.
 *
 * ── What this form may and may not say ─────────────────────────────────────
 *
 * The server answers 200 with the same body whether or not the identifier
 * matches an account (security.md §11). This form must not undo that: the
 * success panel says "if an account matches", never "we sent it to j***@…".
 * A page that confirms an address exists is an enumeration oracle with a
 * friendly face.
 *
 * ── The dev shortcut ───────────────────────────────────────────────────────
 *
 * There is no mail transport in this build, so outside production the API
 * returns the raw token as `devResetToken` (see `auth.ts`). When it is present
 * this form renders a link straight to the reset page. It is deliberately
 * labelled "development only" — a production build never receives the token, so
 * the branch simply does not render there.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';

import { useLang } from '@/lib/hooks';
import { useStore } from '@/components/providers/store-provider';
import { requestPasswordReset } from '@/lib/api/account';
import { isValidEmail, isValidBdPhone } from '@/lib/account-validation';
import { Field, FormAlert } from '@/components/account/form-fields';

export function ForgotPasswordForm() {
  const { tu } = useLang();
  const store = useStore();

  const [identifier, setIdentifier] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      const value = identifier.trim();
      if (!value) {
        setFieldError(tu('invalidEmail'));
        return;
      }
      // The server accepts either; the client check only catches a typo before
      // it costs a round trip and one of the reset rate-limit tokens.
      if (!isValidEmail(value) && !isValidBdPhone(value)) {
        setFieldError(tu('invalidEmail'));
        return;
      }
      setFieldError(null);

      setSubmitting(true);
      try {
        setDevToken(await requestPasswordReset(value));
        setSent(true);
      } catch (error) {
        setFormError(messageFor(error, tu));
      } finally {
        setSubmitting(false);
      }
    },
    [identifier, tu],
  );

  if (sent) {
    return (
      <div className="acct-form">
        <FormAlert tone="success">
          <strong>{tu('resetSentTitle')}</strong>
          <br />
          {tu('resetSentBody')}
        </FormAlert>

        <p className="acct-hint">
          {tu('resetNoMessage')} <a href={`tel:${store.phone}`}>{store.phone}</a>
        </p>

        {devToken && (
          <p className="acct-hint">
            {tu('resetDevNote')}{' '}
            <Link href={`/reset-password?token=${encodeURIComponent(devToken)}`} className="acct-link">
              {tu('resetPassword')}
            </Link>
          </p>
        )}

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
        label={tu('emailOrPhone')}
        value={identifier}
        onChange={setIdentifier}
        type="text"
        inputMode="email"
        autoComplete="username"
        placeholder="you@example.com"
        error={fieldError ?? undefined}
        required
      />

      <button type="submit" className="btn red acct-submit" disabled={submitting}>
        {submitting ? tu('loading') : tu('sendResetLink')}
      </button>

      <p className="acct-switch">
        <Link href="/login" className="acct-link">
          {tu('backToSignIn')}
        </Link>
      </p>
    </form>
  );
}

/**
 * 429 is not "your details are wrong" — it is "wait a minute". Telling a
 * shopper otherwise sends them round the reset flow for no reason, which is the
 * same distinction `login-form.tsx` makes.
 */
function messageFor(error: unknown, tu: (key: 'rateLimited' | 'genericAuthError') => string): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    if (status === 429) return tu('rateLimited');
  }

  const message = (error as { message?: unknown })?.message;
  if (typeof message === 'string' && message.trim().length > 0) return message;

  return tu('genericAuthError');
}
