/**
 * /health — the only route Phase 0 ships.
 *
 * It has to be honest: a 200 that says "ok" while the database is unreachable
 * is worse than a 503. So it actually pings MySQL and reports the result.
 *
 * Contract: { success: true, data: { status, database, uptime, version } }
 */

import { Router } from 'express';
import { checkDatabase } from '../config/database.js';
import { ok } from '../types/api.js';

export const healthRouter: Router = Router();

healthRouter.get('/health', async (_req, res) => {
  const database = await checkDatabase();

  res.status(database ? 200 : 503).json(
    ok({
      status: database ? 'ok' : 'degraded',
      database: database ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
    }),
  );
});
