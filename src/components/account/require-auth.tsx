/**
 * RequireAuth — gates a route behind a session, client-side.
 *
 * Why client-side: the credential is an HttpOnly cookie the Next server cannot
 * read either, so there is no server-side session to check without a round-trip
 * on every render. The API is the real gate — every protected endpoint returns
 * 401 regardless of what this component does. This exists so a signed-out
 * visitor gets a sign-in prompt instead of a page that flashes empty and then
 * errors.
 *
 * The `next` parameter preserves where the shopper was going, so signing in
 * from `/checkout` returns them to `/checkout` rather than the homepage.
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useSessionStore } from '@/lib/store/session-store';
import { useLang } from '@/lib/hooks';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { tu } = useLang();
  const status = useSessionStore((s) => s.status);
  const pathname = usePathname();
  const router = useRouter();

  /**
   * Redirect after the guard has decided, not during render.
   *
   * A `router.replace` in the render body runs on every render and can fire
   * before the session resolves, bouncing a signed-in user to /login.
   */
  useEffect(() => {
    if (status !== 'anonymous') return;
    const next = encodeURIComponent(pathname || '/');
    router.replace(`/login?next=${next}`);
  }, [status, pathname, router]);

  if (status === 'unknown') {
    return (
      <div className="wrap" aria-busy="true" style={{ padding: '32px 0' }}>
        <Skeleton className="h-[120px] w-full" />
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="wrap">
        <EmptyState
          tone="empty"
          title={tu('authRequired')}
          body={tu('authRequiredBody')}
          action={
            <Link className="btn red" href={`/login?next=${encodeURIComponent(pathname || '/')}`}>
              {tu('signIn')}
            </Link>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
