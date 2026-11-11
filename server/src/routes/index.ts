/**
 * Route aggregator.
 *
 * Phase 0 ships /health only. Phase 6 adds the public catalog routes under
 * /api/v1, Phase 8 the customer routes, Phase 9 the admin routes — all
 * mounted here, so `app.ts` never changes shape again.
 */

import { Router } from 'express';
import { healthRouter } from './health.js';

export const routes: Router = Router();

// Unversioned — load balancers and uptime monitors expect a stable path.
routes.use(healthRouter);

// Versioned API surface. Empty in Phase 0 by design.
export const apiV1: Router = Router();
routes.use('/api/v1', apiV1);
