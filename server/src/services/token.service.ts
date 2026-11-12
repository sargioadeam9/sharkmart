/**
 * Session tokens — security.md §4.
 *
 * Two tokens, two jobs:
 *   - **Access** (15 min): a stateless JWT the API verifies on every request.
 *     Short TTL is what makes statelessness acceptable.
 *   - **Refresh** (7 days): a JWT *plus* a database row. The row is the real
 *     authority; the JWT only carries the lookup key.
 *
 * Why the refresh token needs a row at all: rotation and reuse detection are
 * impossible statelessly. "This token was already used" is a fact about
 * history, and a self-contained JWT has no history. So every refresh token is
 * a `RefreshToken` row, and presenting a revoked one is proof of replay.
 *
 * Reuse detection: tokens are grouped into a `familyId` at login. Every
 * rotation issues a new row in the same family and revokes the old one. If a
 * revoked token is ever presented again, either the token leaked or the client
 * is buggy — both mean the family is untrustworthy, so the whole family is
 * revoked and the user re-authenticates. That is the standard OAuth BCP.
 *
 * Storage: only `sha256(token)` reaches the database. A dump of the table
 * cannot be replayed.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../config/database.js';
import { env, requireAuthSecrets } from '../config/env.js';

export interface AccessClaims {
  sub: string;
  role: string;
  /** Token family — lets a password change revoke live access tokens too. */
  fam: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  familyId: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

/** Parses `15m` / `7d` / `900s` / `3600` into seconds. */
export function parseTtl(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/i.exec(value.trim());
  if (!match) throw new Error(`Unparseable TTL: ${value}`);

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86_400 : 1;

  return amount * multiplier;
}

export const ACCESS_TTL_SECONDS = parseTtl(env.ACCESS_TOKEN_TTL);
export const REFRESH_TTL_SECONDS = parseTtl(env.REFRESH_TOKEN_TTL);

function keys() {
  const { access, refresh } = requireAuthSecrets();
  const enc = new TextEncoder();
  return { access: enc.encode(access), refresh: enc.encode(refresh) };
}

/** sha256 hex — the only form of a refresh token that is ever persisted. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function signAccess(userId: string, role: string, familyId: string): Promise<string> {
  return new SignJWT({ role, fam: familyId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('sharkmart')
    .setAudience('sharkmart-api')
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(keys().access);
}

async function signRefresh(userId: string, familyId: string, tokenId: string): Promise<string> {
  return new SignJWT({ fam: familyId, jti: tokenId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('sharkmart')
    .setAudience('sharkmart-refresh')
    .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
    .sign(keys().refresh);
}

/**
 * Issues a brand-new session family. Called on login and register only.
 *
 * `familyId` is a fresh uuid per login, so two devices are two families and
 * logging out of one does not kill the other.
 */
export async function issueSession(
  userId: string,
  role: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<IssuedTokens> {
  const familyId = randomUUID();
  const tokenId = randomUUID();

  const refreshToken = await signRefresh(userId, familyId, tokenId);
  const accessToken = await signAccess(userId, role, familyId);

  const now = Date.now();
  const refreshExpiresAt = new Date(now + REFRESH_TTL_SECONDS * 1000);

  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      userId,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
      ipAddress: meta.ipAddress,
    },
  });

  return {
    accessToken,
    refreshToken,
    familyId,
    accessExpiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000),
    refreshExpiresAt,
  };
}

export type RotateResult =
  | { ok: true; tokens: IssuedTokens; userId: string; role: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' | 'revoked' };

/**
 * Rotates a refresh token.
 *
 * The order matters. The row is looked up by hash, then:
 *   - missing            → invalid (never existed, or a forged token)
 *   - already revoked    → **reuse**: revoke the whole family, refuse
 *   - past expiresAt     → expired
 *   - otherwise          → revoke this row, issue a successor in the same family
 *
 * The revoke-then-issue pair is not wrapped in a transaction on purpose: if the
 * process dies between them the user is logged out, which is the safe failure.
 * The opposite order could leave two live tokens in one family.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<RotateResult> {
  let payload: { sub?: string; fam?: string };
  try {
    const verified = await jwtVerify(rawToken, keys().refresh, {
      issuer: 'sharkmart',
      audience: 'sharkmart-refresh',
    });
    payload = verified.payload as { sub?: string; fam?: string };
  } catch {
    // A bad signature, wrong audience or expired JWT. All read as invalid;
    // distinguishing them would tell an attacker which guess was closer.
    return { ok: false, reason: 'invalid' };
  }

  if (!payload.sub || !payload.fam) return { ok: false, reason: 'invalid' };

  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: { id: true, role: true, isActive: true } } },
  });

  if (!row) return { ok: false, reason: 'invalid' };

  /**
   * Reuse. The token is genuine and correctly signed, but it was already
   * consumed — so either it leaked or the client replayed it. Either way the
   * family is compromised: revoke every token in it and make the user log in
   * again. This is the control the gate calls "reuse detection".
   */
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: 'reused' };
  }

  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (!row.user.isActive) return { ok: false, reason: 'revoked' };

  const nextId = randomUUID();
  const refreshToken = await signRefresh(row.userId, row.familyId, nextId);
  const accessToken = await signAccess(row.userId, row.user.role, row.familyId);

  const now = Date.now();
  const refreshExpiresAt = new Date(now + REFRESH_TTL_SECONDS * 1000);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedBy: nextId },
    }),
    prisma.refreshToken.create({
      data: {
        id: nextId,
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent?.slice(0, 255),
        ipAddress: meta.ipAddress,
      },
    }),
  ]);

  return {
    ok: true,
    userId: row.userId,
    role: row.user.role,
    tokens: {
      accessToken,
      refreshToken,
      familyId: row.familyId,
      accessExpiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000),
      refreshExpiresAt,
    },
  };
}

/** Verifies an access token. Returns null for anything not currently valid. */
export async function verifyAccessToken(rawToken: string): Promise<AccessClaims | null> {
  try {
    const verified = await jwtVerify(rawToken, keys().access, {
      issuer: 'sharkmart',
      audience: 'sharkmart-api',
    });
    const payload = verified.payload as { sub?: string; role?: string; fam?: string };
    if (!payload.sub || !payload.role || !payload.fam) return null;
    return { sub: payload.sub, role: payload.role, fam: payload.fam };
  } catch {
    return null;
  }
}

/** Revokes one family — a single logout. */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Reads the family id out of a refresh token without rotating it.
 *
 * Logout needs to know which family to revoke, and the token is the only thing
 * carrying that. Verifying the signature is enough — we are not granting
 * anything, only identifying a session to end. An invalid token returns null
 * and logout proceeds as a no-op, which is the correct behaviour for a client
 * presenting a token we never issued.
 */
export async function familyFromRefreshToken(rawToken: string): Promise<string | null> {
  try {
    const verified = await jwtVerify(rawToken, keys().refresh, {
      issuer: 'sharkmart',
      audience: 'sharkmart-refresh',
    });
    const payload = verified.payload as { fam?: string };
    return payload.fam ?? null;
  } catch {
    return null;
  }
}

/**
 * Revokes every family for a user — "log out everywhere", and the mandatory
 * consequence of a password change or reset (security.md §4, §5.5).
 *
 * Access tokens are stateless and cannot be recalled individually, so they stay
 * valid for up to their 15-minute TTL. That is the documented cost of a
 * stateless access token; the refresh path — which is what actually mints new
 * sessions — is dead immediately.
 */
export async function revokeAllFamilies(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Opaque random token for password reset links. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}
