/**
 * Express app assembly.
 *
 * Kept separate from index.ts so tests can import the app without binding a
 * port (Phase 12 uses this with Supertest).
 */

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { corsOrigins, isProduction } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
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

  // 1 MB is generous for JSON; uploads go through multer in Phase 9.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.disable('x-powered-by');

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (isProduction) {
    app.set('trust proxy', 1);
  }

  return app;
}
