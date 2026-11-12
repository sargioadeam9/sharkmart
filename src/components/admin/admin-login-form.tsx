'use client';

/**
 * Admin sign-in form.
 *
 * Deliberately separate from the storefront's `LoginForm`:
 *
 *   - The storefront form redirects to `/` or `?next`; this one always lands on
 *     `/admin`, because a staff member signing in here wants the panel.
 *   - The storefront form offers registration and password reset. An admin
 *     login offers neither — staff accounts are created by a SUPER_ADMIN, not
 *     self-serve. A "create account" link here would be a dead end at best.
 *   - The copy is the admin's, and the styling is the admin's tokens.
 *
 * The security behaviour is identical, because it is the same endpoint:
 * `POST /api/v1/auth/login` with the same rate limit, the same account lockout
 * and the same generic error message (security.md §11 — an unknown account and
 * a wrong password must be indistinguishable).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';

import { sessionFetch, SessionClientError } from '@/lib/api/session-client';
import { safeNext } from '@/lib/safe-next';

export function AdminLoginForm({ next }: { next: string }) {
  const router = useRouter();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await sessionFetch('/auth/login', {
        method: 'POST',
        body: { identifier: identifier.trim(), password },
      });

      /**
       * The API has set the session cookies. `router.refresh()` is required
       * before the push so the server components re-render with the new
       * cookie — without it the layout would still see the anonymous render
       * and bounce straight back to login.
       */
      router.refresh();
      router.push(next);
    } catch (caught) {
      if (caught instanceof SessionClientError) {
        // A 403 here means the credentials were fine but the role is not staff.
        // The API does not say that (it returns the generic message), so the
        // form shows the same thing a wrong password shows — no oracle.
        setError(caught.message);
      } else {
        setError('Something went wrong. Try again.');
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="admin-identifier">Email or phone</label>
        <input
          id="admin-identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="you@sharkmart.com.bd"
        />
      </div>

      <div className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="admin-password">Password</label>
        <div style={{ position: 'relative' }}>
          <input
            id="admin-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%', paddingRight: 48 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--muted)',
              borderRadius: 8,
            }}
          >
            {showPassword ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--bad)',
            background: 'var(--bad-bg)',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 13.5,
            fontWeight: 600,
            marginBottom: 14,
          }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn"
        disabled={pending || identifier.trim().length === 0 || password.length === 0}
        style={{ width: '100%' }}
      >
        {pending ? (
          <>
            <Loader2 size={17} className="spin" aria-hidden />
            Signing in…
          </>
        ) : (
          <>
            <LogIn size={17} aria-hidden />
            Sign in
          </>
        )}
      </button>

      <style>{`.spin{animation:admin-spin 1s linear infinite}@keyframes admin-spin{to{transform:rotate(360deg)}}`}</style>
    </form>
  );
}

/** Re-exported so the page can validate `next` without importing the lib twice. */
export { safeNext };
