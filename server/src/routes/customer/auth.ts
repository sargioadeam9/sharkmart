/**
 * `/api/v1/auth/*` — register, login, refresh, logout, password reset.
 *
 * Every route here is a security surface, so the shape is uniform:
 *   validate (strict Zod) → rate limit → service → envelope + cookies.
 *
 * No business logic lives in this file. The service owns the rules; the route
 * owns transport (cookies, status codes, what is safe to return).
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { LIMITS, slidingWindowLimit } from '../../middleware/rateLimiter.js';
import { ok } from '../../types/api.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { isProduction } from '../../config/env.js';
import {
  clearSessionCookies,
  csrfProtection,
  setSessionCookies,
} from '../../middleware/session.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  changePassword,
  login,
  register,
  requestPasswordReset,
  resetPassword,
} from '../../services/auth.service.js';
import { revokeAllFamilies, revokeFamily, familyFromRefreshToken, rotateRefreshToken } from '../../services/token.service.js';
import { REFRESH_COOKIE } from '../../middleware/session.js';
import {
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
} from '../../validators/auth.schema.js';

export const authRouter: Router = Router();

/**
 * POST /auth/register
 *
 * Rate limited 3/min per IP. On success the user is signed in immediately —
 * making them log in again right after registering is friction with no security
 * value, since the password was just verified by being set.
 */
authRouter.post(
  '/register',
  slidingWindowLimit(LIMITS.register),
  validate({ body: registerBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof register>[0];
      const { user, tokens } = await register(body, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });

      setSessionCookies(res, tokens);
      res.status(201).json(ok({ user }));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /auth/login
 *
 * Two limiters, deliberately: the IP bucket stops one host hammering many
 * accounts, and the account lockout inside the service stops many hosts
 * hammering one account. Neither alone covers both attacks.
 */
authRouter.post(
  '/login',
  slidingWindowLimit(LIMITS.login),
  validate({ body: loginBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof login>[0];
      const { user, tokens } = await login(body, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });

      setSessionCookies(res, tokens);
      res.json(ok({ user }));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /auth/refresh
 *
 * Rotates the refresh token and re-issues both cookies.
 *
 * A `reused` result is a security event, not a normal failure: it means a
 * consumed token was replayed. The family is already revoked by the service, so
 * the response just clears the cookies and says "sign in again". Logging it is
 * the caller's job — see `requestLogger`'s redaction rules.
 */
authRouter.post(
  '/refresh',
  slidingWindowLimit(LIMITS.refresh),
  async (req, res, next) => {
    try {
      const raw = req.cookies?.[REFRESH_COOKIE];
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new HttpError(401, 'UNAUTHORIZED', 'No session to refresh.');
      }

      const result = await rotateRefreshToken(raw, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });

      if (!result.ok) {
        clearSessionCookies(res);
        throw new HttpError(
          401,
          'UNAUTHORIZED',
          result.reason === 'reused'
            ? 'Your session was ended for security. Please sign in again.'
            : 'Your session has expired. Please sign in again.',
        );
      }

      setSessionCookies(res, result.tokens);
      res.json(ok({ refreshed: true }));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /auth/logout
 *
 * Revokes the current family only — other devices stay signed in. "Log out
 * everywhere" is a separate, explicit action (`/auth/logout-all`).
 *
 * Idempotent: logging out with no session is a 200, not a 401. A client that
 * fires logout twice must not see an error on the second call.
 *
 * The family is read from the refresh token's own claims rather than by
 * rotating it: rotating would mint a successor token we immediately throw away,
 * and would trip reuse detection if the client later presented the old one.
 */
authRouter.post('/logout', csrfProtection, async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw === 'string' && raw.length > 0) {
      const familyId = await familyFromRefreshToken(raw);
      if (familyId) await revokeFamily(familyId);
    }

    clearSessionCookies(res);
    res.json(ok({ loggedOut: true }));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/logout-all
 *
 * Revokes every family for the signed-in user.
 */
authRouter.post('/logout-all', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    await revokeAllFamilies(req.session!.id);
    clearSessionCookies(res);
    res.json(ok({ loggedOut: true }));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/forgot-password
 *
 * Always 200, always the same body (security.md §5.1, §11). The response must
 * not reveal whether the identifier belongs to an account.
 *
 * The raw token is returned **only outside production**, and only because there
 * is no mail transport wired yet. In production it is never in the response —
 * that would be an account takeover for anyone who can read the HTTP response.
 * When the mailer lands (Phase 10, SMS/email), this branch disappears.
 */
authRouter.post(
  '/forgot-password',
  slidingWindowLimit(LIMITS.reset),
  validate({ body: forgotPasswordBody }),
  async (req, res, next) => {
    try {
      const { identifier } = req.body as { identifier: string };
      const { rawToken } = await requestPasswordReset(identifier);

      const payload: Record<string, unknown> = {
        message: 'If an account matches, a reset link has been sent.',
      };

      if (!isProduction && rawToken) {
        payload.devResetToken = rawToken;
      }

      res.json(ok(payload));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /auth/reset-password
 *
 * Consumes the token, sets the password and revokes every session.
 */
authRouter.post(
  '/reset-password',
  slidingWindowLimit(LIMITS.reset),
  validate({ body: resetPasswordBody }),
  async (req, res, next) => {
    try {
      const { token, password } = req.body as { token: string; password: string };
      await resetPassword(token, password);
      clearSessionCookies(res);
      res.json(ok({ message: 'Your password has been reset. Please sign in.' }));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /auth/change-password
 *
 * Requires the current password — a stolen session alone must not be able to
 * lock the real owner out.
 */
authRouter.post(
  '/change-password',
  requireAuth,
  csrfProtection,
  validate({ body: changePasswordBody }),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      await changePassword(req.session!.id, currentPassword, newPassword);
      clearSessionCookies(res);
      res.json(ok({ message: 'Password changed. Please sign in again.' }));
    } catch (error) {
      next(error);
    }
  },
);
