/**
 * `/admin/login` — the admin sign-in page.
 *
 * Lives in the `(auth)` group, which has NO layout guard. That is the whole
 * reason the group exists: if this page sat under the guarded `(panel)` layout,
 * an anonymous visitor would be redirected here by the middleware, and the
 * layout would then redirect them here again — an infinite loop.
 *
 * `next` is validated with `safeNext` before it reaches the form. The middleware
 * puts the originally-requested path in the query string, and an unvalidated
 * redirect target is an open redirect.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { BRAND } from '@/lib/brand';
import { safeNext } from '@/lib/safe-next';
import { AdminLoginForm } from '@/components/admin/admin-login-form';

export const metadata: Metadata = {
  title: 'Admin sign in',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  /**
   * Default to `/admin`, not `/`. A staff member who lands here without a
   * `next` wants the panel; sending them to the storefront would be a puzzle.
   * `safeNext` falls back to `/` for a bad value, so the fallback is applied
   * after it.
   */
  const raw = safeNext(params.next);
  const next = raw === '/' ? '/admin' : raw;

  return (
    <div className="admin-root" lang="en">
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: 'var(--bg)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div
              className="logo"
              style={{ margin: '0 auto 14px', width: 44, height: 44, borderRadius: 13 }}
              aria-hidden
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M2 14c3-1 5-4 8-6 2-1.4 4-2 6-2 2.2 0 4 1 6 3-1.4.3-2.4 1-3 2 1 .6 1.6 1.4 2 2.4-2.6.6-4.6 2-6 4-1.6 2.2-3.6 3-6 3-3 0-5.4-1.6-7-4.4z"
                  fill="#fff"
                />
              </svg>
            </div>
            <h1 style={{ fontSize: 22 }}>
              {BRAND.nameParts.first}
              <span style={{ color: 'var(--brand)' }}>{BRAND.nameParts.second}</span> admin
            </h1>
            <p style={{ color: 'var(--muted)', marginTop: 6, fontSize: 14 }}>
              Sign in to manage the store.
            </p>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <AdminLoginForm next={next} />
          </div>

          <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: 'var(--muted)' }}>
            <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>
              Back to the store
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
