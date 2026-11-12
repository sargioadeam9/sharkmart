/**
 * Registration form.
 *
 * Field-level validation runs on blur, not on every keystroke: validating while
 * someone types their first character of a password tells them it is too short
 * before they have had a chance to finish, which is noise, not help.
 *
 * The phone field is optional — the server allows an account without one — but
 * when it is filled it must be a real BD mobile, because that number is what
 * the courier calls.
 */

'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useLang } from '@/lib/hooks';
import { useSessionStore } from '@/lib/store/session-store';
import { register as registerRequest } from '@/lib/api/account';
import {
  checkPassword,
  isValidBdPhone,
  isValidEmail,
  normaliseBdPhone,
  passwordStrength,
  required,
} from '@/lib/account-validation';
import { Field, FormAlert } from '@/components/account/form-fields';
import { safeNext } from '@/components/account/login-form';

interface Errors {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirm?: string;
}

export function RegisterForm({ next }: { next: string }) {
  const { tu } = useLang();
  const router = useRouter();
  const signIn = useSessionStore((s) => s.signIn);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = passwordStrength(password);

  const validate = useCallback((): boolean => {
    const next: Errors = {};

    if (!required(name)) next.name = tu('fullName');
    if (!isValidEmail(email)) next.email = tu('invalidEmail');
    if (phone.trim() && !isValidBdPhone(phone)) next.phone = tu('invalidPhone');

    if (!checkPassword(password).valid) next.password = tu('passwordWeak');
    if (confirm !== password) next.confirm = tu('passwordMismatch');

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [name, email, phone, password, confirm, tu]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      if (!validate()) return;

      setSubmitting(true);
      try {
        const user = await registerRequest({
          name: name.trim(),
          email: email.trim(),
          password,
          ...(phone.trim() ? { phone: normaliseBdPhone(phone) } : {}),
        });
        signIn(user);
        router.replace(safeNext(next));
      } catch (error) {
        setFormError(registerMessage(error, tu));
      } finally {
        setSubmitting(false);
      }
    },
    [name, email, phone, password, validate, signIn, router, next, tu],
  );

  return (
    <form className="acct-form" onSubmit={handleSubmit} noValidate>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}

      <Field
        label={tu('fullName')}
        value={name}
        onChange={setName}
        autoComplete="name"
        error={errors.name}
        required
      />

      <Field
        label={tu('email')}
        value={email}
        onChange={setEmail}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={errors.email}
        required
      />

      <Field
        label={tu('phone')}
        value={phone}
        onChange={setPhone}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="01712345678"
        hint={tu('phoneHint')}
        error={errors.phone}
      />

      <div>
        <Field
          label={tu('password')}
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="new-password"
          revealable
          showLabel={tu('showPassword')}
          hideLabel={tu('hidePassword')}
          error={errors.password}
          required
        />

        {/* The strength bar is decorative — the message above is the real
            signal, so this is hidden from assistive tech. */}
        {password.length > 0 && (
          <div className="acct-strength" aria-hidden="true" data-score={strength}>
            {[1, 2, 3, 4].map((step) => (
              <i key={step} className={strength >= step ? 'on' : undefined} />
            ))}
          </div>
        )}
      </div>

      <Field
        label={tu('confirmPassword')}
        value={confirm}
        onChange={setConfirm}
        type="password"
        autoComplete="new-password"
        revealable
        showLabel={tu('showPassword')}
        hideLabel={tu('hidePassword')}
        error={errors.confirm}
        required
      />

      <button type="submit" className="btn red acct-submit" disabled={submitting}>
        {submitting ? tu('loading') : tu('signUp')}
      </button>

      <p className="acct-switch">
        {tu('haveAccount')}{' '}
        <Link href={`/login?next=${encodeURIComponent(safeNext(next))}`} className="acct-link">
          {tu('signIn')}
        </Link>
      </p>
    </form>
  );
}

/**
 * Registration failures.
 *
 * A duplicate email is the one case where the server does say something
 * specific (409 CONFLICT) — and it is safe to, because registration is not an
 * enumeration oracle: the attacker learns the address exists, which they could
 * learn anyway by trying to register it.
 */
function registerMessage(
  error: unknown,
  tu: (key: 'rateLimited' | 'genericAuthError') => string,
): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    const code = 'code' in error ? (error as { code: string }).code : '';

    if (status === 429) return tu('rateLimited');
    if (status === 409 || code === 'CONFLICT') {
      return 'An account with that email already exists. Try signing in instead.';
    }
  }
  return tu('genericAuthError');
}
