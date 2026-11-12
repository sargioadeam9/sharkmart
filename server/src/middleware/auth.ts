/**
 * Authentication and authorization middleware — security.md §6.
 *
 * Two distinct jobs, deliberately separate:
 *
 *   - `requireAuth` answers "who is this?" — it verifies the access token and
 *     puts a typed session on the request.
 *   - `requireRole` answers "may they?" — a permission check, not a name check.
 *
 * The distinction matters because "is logged in" is not authorization. A
 * customer with a valid session must still be refused an admin route, and the
 * refusal must happen server-side regardless of what the UI hides.
 */

import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { fail } from '../types/api.js';
import { verifyAccessToken } from '../services/token.service.js';
import { ACCESS_COOKIE } from './session.js';

export interface SessionUser {
  id: string;
  role: string;
  familyId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionUser;
    }
  }
}

/**
 * Reads the access token from the cookie, falling back to a bearer header.
 *
 * The cookie is the primary transport (AGENTS.md §7.5). The bearer fallback
 * exists for the test suite and for any future native client, and it is not a
 * weakening: a bearer token is not ambient, so it cannot be CSRF'd.
 */
function readAccessToken(req: Request): string | null {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim() || null;
  }
  return null;
}

/**
 * Verifies the session and loads the user.
 *
 * The user is re-read from the database on every request rather than trusted
 * from the token body. That costs one indexed primary-key lookup and buys two
 * things a stateless token cannot give: a deactivated account stops working
 * immediately, and a role change takes effect without waiting for the access
 * token to expire.
 */
export async function loadSession(req: Request): Promise<SessionUser | null> {
  const raw = readAccessToken(req);
  if (!raw) return null;

  const claims = await verifyAccessToken(raw);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, role: true, name: true, email: true, phone: true, isActive: true },
  });

  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    role: user.role,
    familyId: claims.fam,
    name: user.name,
    email: user.email,
    phone: user.phone,
  };
}

/** Rejects an unauthenticated request with the contract envelope. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await loadSession(req);
    if (!session) {
      res.status(401).json(fail('UNAUTHORIZED', 'You must be signed in.'));
      return;
    }
    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attaches a session when one exists, and does nothing when it does not.
 *
 * Used by routes that behave differently for a signed-in user but must still
 * serve a guest — `/cart`, and the checkout path where a guest order is legal.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await loadSession(req);
    if (session) req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Role gate. `requireRole('ADMIN', 'SUPER_ADMIN')` reads as "admin or above".
 *
 * Roles are a flat enum here, not a hierarchy, so the caller lists what it
 * accepts. That is more verbose than a `>=` comparison and much harder to get
 * wrong: adding a new role later cannot silently inherit access to an existing
 * route.
 */
export function requireRole(...roles: string[]) {
  return function roleGate(req: Request, res: Response, next: NextFunction): void {
    if (!req.session) {
      res.status(401).json(fail('UNAUTHORIZED', 'You must be signed in.'));
      return;
    }
    if (!roles.includes(req.session.role)) {
      res.status(403).json(fail('FORBIDDEN', 'You do not have access to this resource.'));
      return;
    }
    next();
  };
}

/** Convenience: any non-customer role is staff. */
export const STAFF_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'ORDER_MANAGER',
  'INVENTORY_STAFF',
  'MARKETING_STAFF',
] as const;

/**
 * The ownership rule, as a type rather than a comment.
 *
 * security.md §6: "Every one of these is enforced in the query, not after the
 * fetch." This helper exists so a route cannot accidentally fetch an order and
 * *then* compare ids — the filter is part of the `where` clause by construction.
 *
 * An address or order belonging to someone else must read as **404, not 403**:
 * a 403 confirms the id exists, which is an enumeration oracle.
 */
export function ownerFilter(session: SessionUser): { userId: string } {
  return { userId: session.id };
}
