/**
 * `/api/v1/admin/orders` — the orders module of the admin panel.
 *
 * ── What this router does NOT do ────────────────────────────────────────────
 *
 * It does not apply `rateLimit`, `requireAuth` or the staff gate. Those are
 * mounted once on `adminRouter` (routes/admin/index.ts:30-54) and this router is
 * a sub-router of it. Re-applying them here would double-count the rate-limit
 * bucket and split the auth chain across two files.
 *
 * What it DOES apply is `requirePermission` on every route — `orders:read` for
 * reads, `orders:write` for status/courier/notes, and `orders:refund` for
 * anything that moves money. That split is the point: an INVENTORY_STAFF member
 * can read orders (they need to know what to pick) and cannot mark one refunded.
 *
 * ── Route order matters ─────────────────────────────────────────────────────
 *
 * `GET /counts` and `GET /lookup` are declared before `GET /:id`. Express matches
 * in declaration order, so with `/:id` first a request for `/counts` would be
 * parsed as an order id and 422 on the uuid check. Same footgun as
 * `/form-options` in the products router.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { can } from '../../services/permissions.js';
import { validate } from '../../middleware/validate.js';
import { ok, paginationMeta } from '../../types/api.js';
import {
  adminOrderListQuery,
  orderBulkStatusBody,
  orderCourierBody,
  orderIdParams,
  orderNotesBody,
  orderPaymentBody,
  orderStatusBody,
} from '../../validators/adminOrder.schema.js';
import {
  bulkChangeOrderStatus,
  changeOrderStatus,
  getAdminOrder,
  getAdminOrderByNumber,
  listAdminOrders,
  orderStatusCounts,
  recordOrderPayment,
  setOrderCourier,
  setOrderNotes,
  type Actor,
} from './order.service.js';

export const ordersRouter: Router = Router();

/**
 * The acting user and their IP, for the audit row.
 *
 * `req.ip` is the only honest source — it is the value the rate limiter uses and
 * the one `trust proxy` is configured to make correct behind a load balancer
 * (app.ts:81). Reading `X-Forwarded-For` by hand would let a client forge the
 * audit trail.
 */
function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return {
    userId: req.session!.id,
    ipAddress: req.ip ?? null,
  };
}

// ─── Counts (static, before /:id) ──────────────────────────────────────────

/**
 * GET /counts — the numbers behind the status tabs.
 *
 * Separate from the list so the tabs can render on a page where the list itself
 * is filtered to one status. One `groupBy` behind it.
 */
ordersRouter.get('/counts', requirePermission('orders:read'), async (_req, res, next) => {
  try {
    res.json(ok(await orderStatusCounts()));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /lookup?orderNumber=SM-XXXX — resolve a public order number to an id.
 *
 * The global search box in the topbar accepts an order number. This is the
 * endpoint that turns it into something the drawer can open, and it is why the
 * search box does not have to know the internal uuid.
 */
ordersRouter.get('/lookup', requirePermission('orders:read'), async (req, res, next) => {
  try {
    const orderNumber = String(req.query.orderNumber ?? '').trim();

    if (!orderNumber) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'orderNumber is required.' },
      });
      return;
    }

    res.json(ok(await getAdminOrderByNumber(orderNumber)));
  } catch (error) {
    next(error);
  }
});

// ─── List ──────────────────────────────────────────────────────────────────

ordersRouter.get(
  '/',
  requirePermission('orders:read'),
  validate({ query: adminOrderListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listAdminOrders>[0];
      const result = await listAdminOrders(query);

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

// ─── Bulk status ───────────────────────────────────────────────────────────

/**
 * POST /bulk/status — the sticky bulk bar's action.
 *
 * Declared before `/:id` for the same reason `/counts` is: `bulk` is a static
 * segment in a position where `/:id` also matches.
 */
ordersRouter.post(
  '/bulk/status',
  requirePermission('orders:write'),
  validate({ body: orderBulkStatusBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof bulkChangeOrderStatus>[0];
      res.json(ok(await bulkChangeOrderStatus(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Detail ────────────────────────────────────────────────────────────────

ordersRouter.get(
  '/:id',
  requirePermission('orders:read'),
  validate({ params: orderIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getAdminOrder(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Status change ─────────────────────────────────────────────────────────

/**
 * POST /:id/status — the single transition endpoint.
 *
 * `orders:write` covers the operational moves (confirm, process, ship, deliver,
 * cancel, return). It does NOT cover the two money moves: REFUND_PENDING →
 * REFUNDED is a refund, and it is gated on `orders:refund` inside the handler
 * rather than by a separate route, because the transition table is one table and
 * splitting the route would split the check.
 */
ordersRouter.post(
  '/:id/status',
  requirePermission('orders:write'),
  validate({ params: orderIdParams, body: orderStatusBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof changeOrderStatus>[1];

      // A move to REFUNDED is a refund, not an operational status change. It
      // needs the money permission, checked here because the route gate above
      // is the operational one. `can()` reads the same matrix the route gate
      // does — `req.session` carries a role, not a permission list.
      if (body.status === 'REFUNDED' && !can(req.session!.role, 'orders:refund')) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Marking an order refunded requires the refund permission.',
          },
        });
        return;
      }

      res.json(ok(await changeOrderStatus(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Payment ───────────────────────────────────────────────────────────────

/**
 * POST /:id/payment — record a collected payment.
 *
 * Gated on `orders:refund`, which is the money permission on this surface. An
 * operator who may not refund should not be able to assert that cash arrived
 * either: both are statements about money that only a manager can make.
 */
ordersRouter.post(
  '/:id/payment',
  requirePermission('orders:refund'),
  validate({ params: orderIdParams, body: orderPaymentBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof recordOrderPayment>[1];
      res.json(ok(await recordOrderPayment(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Courier ───────────────────────────────────────────────────────────────

ordersRouter.post(
  '/:id/courier',
  requirePermission('orders:write'),
  validate({ params: orderIdParams, body: orderCourierBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof setOrderCourier>[1];
      res.json(ok(await setOrderCourier(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Notes ─────────────────────────────────────────────────────────────────

ordersRouter.patch(
  '/:id/notes',
  requirePermission('orders:write'),
  validate({ params: orderIdParams, body: orderNotesBody }),
  async (req, res, next) => {
    try {
      const { notes } = req.body as { notes: string | null };
      res.json(ok(await setOrderNotes(req.params.id!, notes, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);
