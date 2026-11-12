/**
 * Express app assembly.
 *
 * Kept separate from index.ts so tests can import the app without binding a
 * port — every Phase 6 suite uses Supertest against this function.
 */

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { corsOrigins, isProduction, requireAuthSecrets } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { routes } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  /**
   * Fail at boot, not on the first login.
   *
   * A missing or weak JWT secret must stop the process here — an API that boots
   * and then throws a 500 on every auth route is worse than one that refuses to
   * start, because the failure looks like a bug rather than a configuration
   * error.
   */
  requireAuthSecrets();

  // Security headers. CSP is off here because this is a JSON API — the
  // storefront owns its own CSP (frontend.md §16).
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      /**
       * `X-CSRF-Token` and `Idempotency-Key` are custom headers, so a browser
       * preflights them. Without this list the preflight fails and every
       * state-changing request from the storefront is blocked — which looks
       * like a CORS bug, not a missing header.
       */
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'X-Internal-Token'],
      exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
    }),
  );

  /**
   * Gzip. The homepage aggregate is the reason this exists: it carries the
   * whole catalog slice and compresses roughly 8:1. `threshold: 1024` leaves
   * small envelopes alone, where the header overhead costs more than it saves.
   */
  app.use(compression({ threshold: 1024 }));

  // 1 MB is generous for JSON; uploads go through multer in Phase 9.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  /**
   * Cookie parsing, for the session and CSRF cookies (Phase 8).
   *
   * No secret is passed: these cookies are not signed, because the access token
   * is already a signed JWT and the CSRF token is a double-submit value that is
   * compared to a header, not to a stored secret. Signing them would add a
   * second secret to rotate for no security gain.
   */
  app.use(cookieParser());

  app.disable('x-powered-by');

  /**
   * Trust exactly one proxy hop in production.
   *
   * This is what makes `req.ip` (and therefore every rate-limit bucket) honest
   * behind a load balancer. Trusting all hops would let a client spoof
   * `X-Forwarded-For` and reset its own limit — security.md §3.
   */
  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.use(requestLogger);
  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
