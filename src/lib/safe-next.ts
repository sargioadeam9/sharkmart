/**
 * Post-auth redirect target validation.
 *
 * Lives in `lib`, not in the form component, because BOTH sides need it: the
 * login and register pages are server components that sanitise `?next=` before
 * it reaches the client form, and the form re-checks it before navigating.
 *
 * It cannot live in `login-form.tsx`: that module is `'use client'`, and a
 * server component importing a function from it gets
 * "Attempted to call safeNext() from the server but safeNext is on the client".
 * A pure function with no React in it belongs here.
 */

/**
 * Only a relative path is a valid `next`.
 *
 * `//evil.com` and `https://evil.com` both pass a naive `startsWith('/')`
 * check — the first is a protocol-relative URL the browser treats as absolute.
 * An open redirect here would let a phishing link bounce a fresh login straight
 * to an attacker's page.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  return next;
}
