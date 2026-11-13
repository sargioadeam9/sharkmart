/**
 * `/api/v1/admin/inventory` — the inventory module of the admin panel.
 *
 * ── What this router does NOT do ────────────────────────────────────────────
 *
 * It does not apply `rateLimit`, `requireAuth` or the staff gate. Those are
 * mounted once on `adminRouter` (routes/admin/index.ts:32-56) and this router is
 * a sub-router of it. Re-applying them here would double-count the rate-limit
 * bucket and make the auth chain look like it lives in two places, which is how
 * a future route ends up with only one of them.
 *
 * What it DOES apply is `requirePermission` on every route — the per-route
 * decision, and the one the sidebar reads too.
 *
 * ── Route order matters ─────────────────────────────────────────────────────
 *
 * `GET /alerts` and `GET /movements` are declared before `GET /:productId`.
 * Express matches in declaration order, so with `/:productId` first a request
 * for `/alerts` would be parsed as a product id and 422 on the uuid check. Same
 * footgun the products router documents at products.ts:15-20.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok, paginationMeta } from '../../types/api.js';
import {
  adminInventoryListQuery,
  adminMovementsQuery,
  inventoryAdjustBody,
  inventoryProductParams,
} from '../../validators/adminInventory.schema.js';
import {
  adjustStock,
  getInventoryDetail,
  inventoryAlerts,
  listInventory,
  listMovements,
  type Actor,
} from './inventory.service.js';

export const inventoryRouter: Router = Router();

/**
 * The acting user and their IP, for the audit row.
 *
 * `req.ip` is the only honest source — it is the value the rate limiter uses and
 * the one `trust proxy` is configured to make correct behind a load balancer.
 * Reading `X-Forwarded-For` by hand would let a client forge the audit trail.
 */
function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return {
    userId: req.session!.id,
    ipAddress: req.ip ?? null,
  };
}

// ─── Alerts (static, before /:productId) ───────────────────────────────────

/**
 * GET /alerts — the KPI strip.
 *
 * Computed server-side so the browser never counts. A client-side count over
 * one page of twenty would report "3 out of stock" for a catalog with forty.
 */
inventoryRouter.get('/alerts', requirePermission('inventory:read'), async (_req, res, next) => {
  try {
    res.json(ok(await inventoryAlerts()));
  } catch (error) {
    next(error);
  }
});

// ─── Movements (static, before /:productId) ────────────────────────────────

inventoryRouter.get(
  '/movements',
  requirePermission('inventory:read'),
  validate({ query: adminMovementsQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listMovements>[0];
      const result = await listMovements(query);

      res.json(
        ok(
          { items: result.items, total: result.total, page: result.page, limit: result.limit },
          paginationMeta(result.page, result.limit, result.total),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── List ──────────────────────────────────────────────────────────────────

inventoryRouter.get(
  '/',
  requirePermission('inventory:read'),
  validate({ query: adminInventoryListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listInventory>[0];
      const result = await listInventory(query);

      res.json(
        ok(
          { items: result.items, total: result.total, page: result.page, limit: result.limit },
          paginationMeta(result.page, result.limit, result.total),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── Detail ────────────────────────────────────────────────────────────────

inventoryRouter.get(
  '/:productId',
  requirePermission('inventory:read'),
  validate({ params: inventoryProductParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getInventoryDetail(req.params.productId!)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Adjust ────────────────────────────────────────────────────────────────

/**
 * POST /:productId/adjust — the one stock-write endpoint.
 *
 * `inventory:write` is held by INVENTORY_STAFF, ORDER_MANAGER, ADMIN and
 * SUPER_ADMIN. MARKETING_STAFF holds `inventory:read` only, so it can look at
 * the shelf and not move it.
 */
inventoryRouter.post(
  '/:productId/adjust',
  requirePermission('inventory:write'),
  validate({ params: inventoryProductParams, body: inventoryAdjustBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof adjustStock>[1];
      res.json(ok(await adjustStock(req.params.productId!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);
