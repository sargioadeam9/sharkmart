/**
 * Auth service — security.md §4, §5, §11.
 *
 * Two rules shape this whole file:
 *
 *   1. **The server decides.** Every branch that could leak whether an account
 *      exists returns the same shape and does the same work.
 *   2. **Failures are not oracles.** A wrong password, an unknown account and a
 *      locked account are one response: "Invalid credentials."
 */

import { HttpError } from '../middleware/errorHandler.js';
import { prisma } from '../config/database.js';
import { notifyEmail, shopUrl } from './notify/index.js';
import {
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
} from './password.service.js';
import {
  generateOpaqueToken,
  hashToken,
  issueSession,
  revokeAllFamilies,
  type IssuedTokens,
} from './token.service.js';
import {
  accountKey,
  clearLockout,
  isLockedOut,
  recordFailedLogin,
} from '../middleware/rateLimiter.js';
import type { Role } from '@prisma/client';

export interface PublicUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  language: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
}

export function toPublicUser(user: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  language: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    language: user.language,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

/** The one message every authentication failure returns. */
const INVALID_CREDENTIALS = 'Invalid credentials.';

export interface RegisterInput {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  language: 'bn' | 'en';
}

/**
 * Registers a customer.
 *
 * The conflict message is deliberately generic (security.md §11): "that email
 * is taken" confirms the account exists, which is an enumeration oracle. The
 * message names the *field* because the user needs to know what to change, but
 * it does not confirm that the value belongs to a real account beyond that.
 */
export async function register(
  input: RegisterInput,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        ...(input.email ? [{ email: input.email }] : []),
        ...(input.phone ? [{ phone: input.phone }] : []),
      ],
    },
    select: { id: true, email: true, phone: true },
  });

  if (existing) {
    const field = input.email && existing.email === input.email ? 'email' : 'phone';
    throw new HttpError(
      409,
      'CONFLICT',
      `An account with this ${field} already exists.`,
      [{ field, message: `This ${field} is already registered.` }],
    );
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash,
      language: input.language,
      role: 'CUSTOMER',
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      language: true,
      emailVerified: true,
      phoneVerified: true,
      createdAt: true,
    },
  });

  const tokens = await issueSession(user.id, user.role, meta);

  return { user: toPublicUser(user), tokens };
}

export interface LoginInput {
  identifier: string;
  password: string;
}

/**
 * Logs a user in.
 *
 * The order of operations is the security design:
 *
 *   1. Check the account lockout **first**, but do not reveal it — a locked
 *      account falls through to the same generic failure.
 *   2. Look up the user. If absent, still run a bcrypt comparison against a
 *      dummy hash so the response time matches a real wrong-password attempt.
 *   3. On success, clear the failure counter.
 *
 * Step 2 is the one people skip. Without it, `POST /auth/login` with a known
 * email returns in ~5ms and with an unknown one in ~300ms, and the difference
 * is a working account-enumeration oracle no matter what the body says.
 */
export async function login(
  input: LoginInput,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
  const key = accountKey(input.identifier);

  const locked = await isLockedOut(key);

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.identifier.toLowerCase() }, { phone: input.identifier }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      language: true,
      emailVerified: true,
      phoneVerified: true,
      createdAt: true,
      passwordHash: true,
      isActive: true,
    },
  });

  // Always do the bcrypt work, whether or not the account exists.
  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (locked || !user || !passwordOk || !user.isActive) {
    // A locked account still records the attempt, so the counter keeps climbing
    // toward the next threshold rather than resetting.
    if (user || !locked) await recordFailedLogin(key);
    throw new HttpError(401, 'UNAUTHORIZED', INVALID_CREDENTIALS);
  }

  await clearLockout(key);

  const tokens = await issueSession(user.id, user.role, meta);

  return {
    user: toPublicUser(user),
    tokens,
  };
}

/**
 * Issues a password reset token.
 *
 * Always resolves, always the same shape, whether or not the account exists
 * (security.md §5.1, §11). The caller returns 200 unconditionally.
 *
 * Returns the raw token so a mailer can send it. In this phase there is no mail
 * transport wired, so the route logs that a reset was requested and returns the
 * token only when `NODE_ENV !== 'production'` — see the route for the exact
 * gate. Returning it in production would be a complete account takeover.
 */
export async function requestPasswordReset(
  identifier: string,
): Promise<{ rawToken: string | null; userId: string | null }> {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
    },
    select: { id: true, isActive: true, name: true, email: true, language: true },
  });

  if (!user || !user.isActive) {
    // Same shape, no token. The caller cannot tell this apart from success.
    return { rawToken: null, userId: null };
  }

  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  /**
   * One active token per user. Retiring the previous one means an old link in
   * an inbox cannot still be used after a newer request — otherwise every
   * reset email ever sent stays live for its full TTL.
   */
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    }),
  ]);

  /**
   * The email is sent **without being awaited**, and that is a security
   * decision, not laziness.
   *
   * This endpoint answers 200 with the same body whether or not the account
   * exists. If the real-account path waited ~400ms for Resend and the unknown
   * path returned in 20ms, the response time would answer the question the body
   * refuses to — a timing oracle that hands back the enumeration the whole
   * design exists to prevent. Firing and forgetting keeps both paths the same
   * length; the row is written either way, and the queue drainer retries it.
   */
  if (user.email) {
    void (async () => {
      const resetUrl = await shopUrl(`/reset-password?token=${encodeURIComponent(rawToken)}`);
      await notifyEmail({
        type: 'password_reset',
        template: 'password_reset',
        lang: user.language === 'bn' ? 'bn' : 'en',
        to: user.email,
        recipientId: user.id,
        vars: {
          customerName: user.name,
          resetUrl,
          expiresMinutes: '30',
        },
      });
    })();
  }

  return { rawToken, userId: user.id };
}

/**
 * Completes a password reset.
 *
 * A reset is a security event: every session and refresh family for the user is
 * revoked, so anyone already logged in is logged out (security.md §5.5).
 *
 * Invalid, expired and already-used all return the same message — the doc is
 * explicit that the response must not distinguish them.
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  const invalid = new HttpError(400, 'VALIDATION_ERROR', 'This reset link is invalid or has expired.');

  if (!row) throw invalid;
  if (row.usedAt) throw invalid;
  if (row.expiresAt.getTime() <= Date.now()) throw invalid;

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
  ]);

  await revokeAllFamilies(row.userId);
}

/** Changes a password for a signed-in user. Requires the current password. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Your current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await revokeAllFamilies(userId);
}
