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
import { corsOrigins, isProduction } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { routes } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  // Security headers. CSP is off here because this is a JSON API — the
  // storefront owns its own CSP (frontend.md §16).
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
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
