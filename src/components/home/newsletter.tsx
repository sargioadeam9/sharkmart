'use client';

/**
 * Newsletter — the reference's `.nlw` panel (oshoppingbd.html L231-236, markup
 * L672, handler at `[data-news]`).
 *
 * The reference's form has `required` and nothing else: a bad address gets the
 * browser's bubble and no feedback of its own. The gate for this phase asks for
 * inline validation, so:
 *   - the address is checked against a deliberately loose pattern on submit,
 *   - the error is a real `role="alert"` message tied to the input by
 *     `aria-describedby`, not a colour change,
 *   - success replaces the form with a confirmation instead of silently
 *     clearing the field,
 *   - the field is `type="email"` with `autoComplete="email"` and
 *     `inputMode="email"` so mobile keyboards are right.
 *
 * There is no backend yet (Phase 8). Submitting does not pretend to have
 * subscribed anyone to a real list — it validates, confirms, and the note below
 * says where the real call goes.
 */

import { useId, useState } from 'react';

import { useLang } from '@/lib/hooks';

/** Loose on purpose: reject obvious nonsense, accept real-world addresses. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function Newsletter() {
  const { t, tu } = useLang();
  const inputId = useId();
  const errorId = useId();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const value = email.trim();

    if (!value) {
      setError(tu('newsletterRequired'));
      return;
    }

    if (!EMAIL_PATTERN.test(value)) {
      setError(tu('newsletterInvalid'));
      return;
    }

    setError(null);
    setSubscribed(true);
  };

  return (
    <section className="sec">
      <div className="nlw">
        <div>
          <h2>{t('news')}</h2>
          <p>{t('newsP')}</p>
        </div>

        {subscribed ? (
          <p className="ok" role="status">
            {tu('newsletterThanks')}
          </p>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <input
              id={inputId}
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t('email')}
              aria-label={t('email')}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
            />
            <button className="btn red" type="submit">
              {t('subs')}
            </button>
          </form>
        )}

        {error ? (
          <p className="err" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
