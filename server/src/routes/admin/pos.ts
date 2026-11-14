/**
 * `/api/v1/admin/pos` — the till (Phase 10 pass M).
 *
 * Mounting contract is the same as every other admin module: rate limit, auth
 * and the staff gate live on `adminRouter`; this router adds only
 * `requirePermission`.
 *
 * ── The permission choice ──────────────────────────────────────────────────
 *
 * `orders:write` rather than a new `pos:*` pair. A counter sale is a sale: it
 * creates an order, takes money and moves stock, which is exactly what
 * `orders:write` already authorises. A separate permission would let an operator
 * build a role that can sell at the counter but not fix a mis-typed order,
 * which is a distinction nobody wants to administer.
 *
 * Consequence worth stating: INVENTORY_STAFF and MARKETING_STAFF hold
 * `orders:read` but not `orders:write`, so they cannot open a shift. A cashier
 * is an ORDER_MANAGER (or above) today.
 *
 * ── Route order ────────────────────────────────────────────────────────────
 *
 * `/session/current`, `/session` and `/catalog` are declared before `/:id`
 * paths for the reason every Express router in this project does it: Express
 * matches in declaration order, and `/:id` would swallow `catalog`.
 */

import { Router } from 'express';

import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  posCatalogQuery,
  posSaleBody,
  posSaleIdParams,
  posSaleListQuery,
  posSessionCloseBody,
  posSessionIdParams,
  posSessionListQuery,
  posSessionOpenBody,
} from '../../validators/adminPos.schema.js';
import {
  closeSession,
  createSale,
  currentSession,
  getSale,
  getSession,
  listSales,
  listSessions,
  openSession,
  searchCatalog,
  type Actor,
} from './pos.service.js';

export const posRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

// ─── Shift: current ────────────────────────────────────────────────────────

/**
 * GET /pos/session/current — the caller's open shift, or null.
 *
 * Returns 200 with `{ session: null }` rather than 404 when there is no shift:
 * "you have not opened a shift" is a normal state the till screen renders as a
 * start button, not an error it has to catch and interpret.
 */
posRouter.get('/session/current', requirePermission('orders:write'), async (req, res, next) => {
  try {
    res.json(ok({ session: await currentSession(req.session!.id) }));
  } catch (error) {
    next(error);
  }
});

// ─── Shift: list ───────────────────────────────────────────────────────────

posRouter.get(
  '/session',
  requirePermission('orders:read'),
  validate({ query: posSessionListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listSessions>[0];
      res.json(ok(await listSessions(query)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Shift: open ───────────────────────────────────────────────────────────

posRouter.post(
  '/session/open',
  requirePermission('orders:write'),
  validate({ body: posSessionOpenBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof openSession>[0];
      res.status(201).json(ok({ session: await openSession(body, actorFrom(req)) }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Shift: close ──────────────────────────────────────────────────────────

posRouter.post(
  '/session/:id/close',
  requirePermission('orders:write'),
  validate({ params: posSessionIdParams, body: posSessionCloseBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof closeSession>[1];
      res.json(ok({ session: await closeSession(req.params.id!, body, actorFrom(req)) }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Shift: one ────────────────────────────────────────────────────────────

posRouter.get(
  '/session/:id',
  requirePermission('orders:read'),
  validate({ params: posSessionIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok({ session: await getSession(req.params.id!) }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Catalog search ────────────────────────────────────────────────────────

posRouter.get(
  '/catalog',
  requirePermission('orders:write'),
  validate({ query: posCatalogQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof searchCatalog>[0];
      res.json(ok({ items: await searchCatalog(query) }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Sales: list ───────────────────────────────────────────────────────────

posRouter.get(
  '/sales',
  requirePermission('orders:read'),
  validate({ query: posSaleListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listSales>[0];
      res.json(ok(await listSales(query)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Sales: create ─────────────────────────────────────────────────────────

/**
 * POST /pos/sales — ring up a basket.
 *
 * 201 on a new sale, 200 on a replay of the same `clientRef`. The distinction
 * matters to the screen: a replay must not print a second receipt.
 */
posRouter.post(
  '/sales',
  requirePermission('orders:write'),
  validate({ body: posSaleBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createSale>[0];
      const result = await createSale(body, actorFrom(req));
      res.status(result.replayed ? 200 : 201).json(ok({ ...result.sale, replayed: result.replayed }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Sales: one (the receipt) ──────────────────────────────────────────────

posRouter.get(
  '/sales/:id',
  requirePermission('orders:read'),
  validate({ params: posSaleIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok({ sale: await getSale(req.params.id!) }));
    } catch (error) {
      next(error);
    }
  },
);
