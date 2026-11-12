/**
 * Edge middleware — the cheapest possible gate on `/admin`.
 *
 * Its ONLY job is: "is there a session cookie at all?" No cookie means the
 * visitor is anonymous, so send them to the login page. A present cookie means
 * "let the server decide" — the middleware does not decode it, does not verify
 * it, and does not look at the role.
 *
 * Why it stops there:
 *
 *   - `jsonwebtoken` does not run in the edge runtime, and the access token is
 *     an HS256 JWT verified with a Node-only secret. Verifying it here would
 *     either fail at build time or force the secret into the edge bundle.
 *   - Even if it could verify the signature, it could not answer "is this user
 *     still active, and is their role still staff?" — that needs the database.
 *     A token is a claim about the past; the role may have changed since.
 *
 * So the real check lives in `src/app/admin/layout.tsx`, a server component
 * that calls the API with the cookie and gets an authoritative answer. This
 * file is a redirect for the common case (a logged-out visitor typing /admin),
 * not a security boundary. Nothing here is trusted by anything downstream.
 *
 * The `/admin/login` path is excluded, otherwise the redirect would loop: a
 * logged-out visitor would be sent to login, which would send them to login.
 */

import { NextResponse, type NextRequest } from 'next/server';

/** Matches `ACCESS_COOKIE` in `server/src/middleware/session.ts`. */
const ACCESS_COOKIE = 'sm_access';
/** Matches `REFRESH_COOKIE`. Present even when the access token has expired. */
const REFRESH_COOKIE = 'sm_refresh';

/** The one admin path that must stay reachable without a session. */
const LOGIN_PATH = '/admin/login';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Login is the destination, not a guarded page.
  if (pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`)) {
    return NextResponse.next();
  }

  /**
   * Either cookie counts as "possibly signed in".
   *
   * The access token lives 15 minutes and the refresh token 7 days, so checking
   * only `sm_access` would bounce a user with a perfectly valid session to the
   * login page every time their access token expired — the layout would have
   * refreshed it silently. Presence of either means "go ask the server".
   */
  const hasSession = Boolean(
    request.cookies.get(ACCESS_COOKIE)?.value || request.cookies.get(REFRESH_COOKIE)?.value,
  );

  if (hasSession) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_PATH;
  loginUrl.search = '';

  /**
   * `next` carries the page they wanted, so login can return them to it. It is
   * validated again on the login page (`safeNext`) before any redirect — an
   * unvalidated `next` is an open-redirect.
   */
  loginUrl.searchParams.set('next', pathname);

  /**
   * 302, explicitly.
   *
   * `NextResponse.redirect` defaults to 307, which preserves the method — fine
   * for a POST, but this is a GET-only navigation and the gate specifies 302.
   * A 302 is also the more honest signal here: the target is a page, not a
   * resource to replay the request against.
   */
  return NextResponse.redirect(loginUrl, 302);
}

export const config = {
  /**
   * Scoped to `/admin` only. A matcher of `/:path*` would run this on every
   * storefront request and add a cookie read to pages that do not care.
   */
  matcher: ['/admin/:path*'],
};
