/**
 * Sign-in form.
 *
 * Two behaviours worth stating:
 *
 * 1. **The error message is generic on purpose.** A wrong password and an
 *    unknown account both say "that did not work". The server already refuses
 *    to distinguish them (security.md §11); a client that says "no account with
 *    that email" would hand the enumeration oracle straight back.
 *
 * 2. **Rate limiting is surfaced as its own message.** A 429 is not a wrong
 *    password, and telling a shopper their password is wrong when the real
 *    problem is "wait 60 seconds" sends them to the reset flow for no reason.
 */

'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useLang } from '@/lib/hooks';
import { useSessionStore } from '@/lib/store/session-store';
import { login as loginRequest, isUnauthenticated } from '@/lib/api/account';
import { isValidEmail, isValidBdPhone } from '@/lib/account-validation';
import { safeNext } from '@/lib/safe-next';
import { Field, FormAlert } from '@/components/account/form-fields';

export function LoginForm({ next }: { next: string }) {
  const { tu } = useLang();
  const router = useRouter();
  const signIn = useSessionStore((s) => s.signIn);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = useCallback((): boolean => {
    const errors: { identifier?: string; password?: string } = {};

    const id = identifier.trim();
    if (!id) {
      errors.identifier = tu('invalidEmail');
    } else if (!isValidEmail(id) && !isValidBdPhone(id)) {
      // The server accepts either an email or a phone as the identifier.
      errors.identifier = tu('invalidEmail');
    }

    if (!password) errors.password = tu('passwordWeak');

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [identifier, password, tu]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      if (!validate()) return;

      setSubmitting(true);
      try {
        const user = await loginRequest({ identifier: identifier.trim(), password });
        signIn(user);
        // `next` comes from the query string, so it must be treated as data:
        // only a same-origin path is followed, never an absolute URL. An
        // open redirect here would let a phishing link bounce a fresh login
        // straight to an attacker's page.
        router.replace(safeNext(next));
      } catch (error) {
        setFormError(messageFor(error, tu));
      } finally {
        setSubmitting(false);
      }
    },
    [identifier, password, validate, signIn, router, next, tu],
  );

  return (
    <form className="acct-form" onSubmit={handleSubmit} noValidate>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}

      <Field
        label={tu('email')}
        value={identifier}
        onChange={setIdentifier}
        type="text"
        inputMode="email"
        autoComplete="username"
        placeholder="you@example.com"
        error={fieldErrors.identifier}
        required
      />

      <Field
        label={tu('password')}
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="current-password"
        revealable
        showLabel={tu('showPassword')}
        hideLabel={tu('hidePassword')}
        error={fieldErrors.password}
        required
      />

      <div className="acct-form-row">
        <Link href="/forgot-password" className="acct-link">
          {tu('forgotPassword')}
        </Link>
      </div>

      <button type="submit" className="btn red acct-submit" disabled={submitting}>
        {submitting ? tu('loading') : tu('signIn')}
      </button>

      <p className="acct-switch">
        {tu('noAccount')}{' '}
        <Link href={`/register?next=${encodeURIComponent(safeNext(next))}`} className="acct-link">
          {tu('signUp')}
        </Link>
      </p>
    </form>
  );
}

/**
 * Only a relative path is a valid `next`.
 *
 * `//evil.com` and `https://evil.com` both pass a naive `startsWith('/')` check
 * — the first is a protocol-relative URL the browser treats as absolute.
 *
 * Re-exported from `@/lib/safe-next` so the server pages can import the same
 * implementation without pulling in this `'use client'` module.
 */
export { safeNext } from '@/lib/safe-next';

/** Maps an API failure to the one message the shopper should read. */
function messageFor(error: unknown, tu: (key: 'rateLimited' | 'genericAuthError') => string): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    if (status === 429) return tu('rateLimited');
    if (isUnauthenticated(error)) return tu('genericAuthError');
  }
  return tu('genericAuthError');
}
