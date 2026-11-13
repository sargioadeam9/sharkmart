/**
 * Admin layout — the real authorization check.
 *
 * `src/middleware.ts` only asks "is there a cookie?". This file asks the API
 * "who is this, and may they be here?" and acts on the answer. That split is
 * deliberate:
 *
 *   - The middleware runs on the edge, where the JWT cannot be verified and the
 *     database is unreachable.
 *   - This runs on the server, with the session cookie, and gets an
 *     authoritative answer from `GET /api/v1/admin/me` — including whether the
 *     account is still active and what its role is *now*, not what it was when
 *     the token was issued.
 *
 * Three outcomes, and the difference between the last two matters:
 *
 *   no session (401)  -> redirect to /admin/login
 *   not staff  (403)  -> render a 403 page, NOT a redirect
 *   staff      (200)  -> render the shell
 *
 * The 403 must not redirect. Redirecting a signed-in customer to the login page
 * would either loop (they are already signed in, so login bounces them back) or
 * silently sign them out. A 403 page tells them the truth: you are signed in,
 * and this is not for you.
 *
 * The admin shell is its own route group with its own layout, so it does NOT
 * inherit `(shop)/layout.tsx` or the storefront chrome. The root layout keeps
 * only `<html>`, `<body>`, fonts and the Toaster.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { AdminShell, type AdminNotification } from '@/components/admin/admin-shell';
import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';

export const metadata: Metadata = {
  title: {
    default: 'Admin',
    template: '%s | SharkMart Admin',
  },
  // An admin panel must never be indexed.
  robots: { index: false, follow: false },
};

interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    language: string;
    createdAt: string;
  };
  permissions: string[];
}

interface AttentionItem {
  key: string;
  labelEn: string;
  labelBn: string;
  count: number;
  href: string;
  severity: 'high' | 'warn' | 'ok';
}

interface DashboardResponse {
  needsAttention: AttentionItem[];
  kpis: { orderCount: number };
}

/**
 * Builds the bell's contents from the same "needs attention" data the dashboard
 * uses. One source, so the bell and the dashboard cannot disagree.
 *
 * A failure here is swallowed on purpose: the notification feed is decoration,
 * and a slow aggregate must not stop an operator from reaching the page they
 * asked for. The dashboard itself will surface the error where it matters.
 */
async function loadNotifications(lang: 'en' | 'bn'): Promise<{
  notifications: AdminNotification[];
  orderCount: number;
}> {
  try {
    const response = await adminFetchServer<DashboardResponse>('/admin/dashboard?range=today');
    const attention = response.data.needsAttention ?? [];

    const notifications: AdminNotification[] = attention
      .filter((item) => item.count > 0)
      .map((item) => ({
        id: item.key,
        title: lang === 'bn' ? item.labelBn : item.labelEn,
        detail:
          lang === 'bn' ? `${item.count}টি আইটেম` : `${item.count} item${item.count === 1 ? '' : 's'}`,
        tone: item.severity === 'high' ? 'bad' : 'warn',
        href: item.href,
      }));

    return { notifications, orderCount: response.data.kpis?.orderCount ?? 0 };
  } catch {
    return { notifications: [], orderCount: 0 };
  }
}

/** The 403 page — signed in, but not staff. Deliberately not a redirect. */
function ForbiddenPage({ lang }: { lang: 'en' | 'bn' }) {
  return (
    <div className="admin-root" lang={lang}>
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
        }}
      >
        <div
          className="card"
          style={{ maxWidth: '440px', textAlign: 'center', padding: '36px 28px' }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: 'var(--bad-bg)',
              color: 'var(--bad)',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 16px',
              fontWeight: 800,
              fontSize: 20,
            }}
            aria-hidden
          >
            403
          </div>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>
            {lang === 'bn' ? 'প্রবেশাধিকার নেই' : 'No access'}
          </h1>
          <p style={{ color: 'var(--muted)', marginBottom: 22 }}>
            {lang === 'bn'
              ? 'আপনি সাইন ইন করেছেন, কিন্তু এই অ্যাকাউন্টের অ্যাডমিন প্যানেলে প্রবেশাধিকার নেই।'
              : 'You are signed in, but this account does not have access to the admin panel.'}
          </p>
          <Link href="/" className="btn ghost">
            {lang === 'bn' ? 'স্টোরে ফিরে যান' : 'Back to the store'}
          </Link>
        </div>
      </main>
    </div>
  );
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();

  /**
   * The wordmark, from store settings.
   *
   * Fetched separately from `/admin/me` and deliberately non-fatal: if the
   * settings read fails, the shell falls back to the BRAND constant rather than
   * refusing to render the whole admin panel over a sidebar label.
   */
  const brand = await adminFetchServer<{ nameFirst: string; nameSecond: string }>(
    '/admin/settings/profile',
  )
    .then((response) => ({
      first: response.data.nameFirst,
      second: response.data.nameSecond,
    }))
    .catch(() => undefined);

  let me: MeResponse;
  try {
    const response = await adminFetchServer<MeResponse>('/admin/me');
    me = response.data;
  } catch (error) {
    if (error instanceof AdminApiError) {
      // No session — send them to login, carrying the page they wanted.
      if (error.isUnauthenticated) redirect('/admin/login');
      // Signed in but not staff — the honest answer, not a redirect loop.
      if (error.isForbidden) return <ForbiddenPage lang={lang} />;
    }
    // The API is unreachable. Say so rather than rendering an empty shell that
    // looks like an empty store.
    return (
      <div className="admin-root" lang={lang}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div className="card" style={{ maxWidth: 460, textAlign: 'center', padding: '32px 26px' }}>
            <h1 style={{ fontSize: 19, marginBottom: 8 }}>
              {lang === 'bn' ? 'API-তে পৌঁছানো যাচ্ছে না' : 'Cannot reach the API'}
            </h1>
            <p style={{ color: 'var(--muted)' }}>
              {lang === 'bn'
                ? 'অ্যাডমিন প্যানেল লোড করতে API সার্ভার চালু থাকতে হবে।'
                : 'The admin panel needs the API server running before it can load.'}
            </p>
          </div>
        </main>
      </div>
    );
  }

  const { notifications, orderCount } = await loadNotifications(lang);

  return (
    <AdminShell
      user={{
        id: me.user.id,
        name: me.user.name,
        email: me.user.email,
        role: me.user.role,
      }}
      permissions={me.permissions}
      lang={lang}
      brand={brand}
      notifications={notifications}
      orderCount={orderCount}
    >
      {children}
    </AdminShell>
  );
}
