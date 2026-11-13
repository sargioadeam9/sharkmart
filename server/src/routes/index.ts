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
import { settingsPublicRouter } from './public/settings.js';
import { brandsRouter, categoriesRouter } from './public/categories.js';
import {
  flashSaleRouter,
  homepageRouter,
  landingRouter,
  searchRouter,
} from './public/discovery.js';
import { authRouter } from './customer/auth.js';
import { meRouter } from './customer/me.js';
import { meOrdersRouter, trackRouter } from './customer/orders.js';
import { cartRouter } from './customer/cart.js';
import { checkoutRouter } from './customer/checkout.js';
import { wishlistRouter } from './customer/wishlist.js';
import { adminRouter } from './admin/index.js';

export const routes: Router = Router();

// Unversioned — load balancers and uptime monitors expect a stable path.
routes.use(healthRouter);

// Versioned API surface.
export const apiV1: Router = Router();

// ── Public catalog (Phase 6) ────────────────────────────────────────────
apiV1.use('/products', productsRouter);
apiV1.use('/categories', categoriesRouter);
apiV1.use('/brands', brandsRouter);
apiV1.use('/search', searchRouter);
apiV1.use('/flash-sale', flashSaleRouter);
apiV1.use('/homepage', homepageRouter);
apiV1.use('/landing', landingRouter);
apiV1.use('/settings', settingsPublicRouter);

// ── Customer (Phase 8) ──────────────────────────────────────────────────
apiV1.use('/auth', authRouter);
apiV1.use('/cart', cartRouter);
apiV1.use('/checkout', checkoutRouter);
apiV1.use('/track', trackRouter);

/**
 * `/me` carries the profile, the address book, the orders and the wishlist.
 *
 * The sub-routers are mounted under `/me` here rather than each declaring the
 * prefix, so the ownership middleware in `meRouter` covers every one of them —
 * a new `/me/*` route cannot accidentally ship without `requireAuth`.
 */
apiV1.use('/me/orders', meOrdersRouter);
apiV1.use('/me/wishlist', wishlistRouter);
apiV1.use('/me', meRouter);

// ── Admin (Phase 9) ────────────────────────────────────────────────────────
// Mounted after the customer surface. Its own router carries the admin rate
// bucket, `requireAuth` and the staff gate, so nothing here can accidentally
// serve an admin route without a session.
apiV1.use('/admin', adminRouter);

routes.use('/api/v1', apiV1);
