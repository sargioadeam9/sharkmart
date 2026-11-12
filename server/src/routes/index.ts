/**
 * Route aggregator.
 *
 * Phase 0 ships /health only. Phase 6 adds the public catalog routes under
 * /api/v1, Phase 8 the customer routes, Phase 9 the admin routes — all
 * mounted here, so `app.ts` never changes shape again.
 */

import { Router } from 'express';
import { healthRouter } from './health.js';
import { productsRouter } from './public/products.js';
import { brandsRouter, categoriesRouter } from './public/categories.js';
import {
  flashSaleRouter,
  homepageRouter,
  landingRouter,
  searchRouter,
} from './public/discovery.js';

export const routes: Router = Router();

// Unversioned — load balancers and uptime monitors expect a stable path.
routes.use(healthRouter);

// Versioned API surface.
export const apiV1: Router = Router();

apiV1.use('/products', productsRouter);
apiV1.use('/categories', categoriesRouter);
apiV1.use('/brands', brandsRouter);
apiV1.use('/search', searchRouter);
apiV1.use('/flash-sale', flashSaleRouter);
apiV1.use('/homepage', homepageRouter);
apiV1.use('/landing', landingRouter);

routes.use('/api/v1', apiV1);
