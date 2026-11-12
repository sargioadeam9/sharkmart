/**
 * `/api/v1/me/orders` and `/api/v1/track/:orderNumber`.
 *
 * The IDOR gate item lives here: `/orders/:id` for another user's order must
 * return 403/404, not data. It is enforced by putting `userId` in the `where`
 * clause — a foreign id simply does not match, so it is a 404 and the response
 * does not confirm the order exists.
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { csrfProtection } from '../../middleware/session.js';
import { ok, paginationMeta } from '../../types/api.js';
import { notFound } from '../../middleware/errorHandler.js';
import {
  cancelOrder,
  getOrderForUser,
  listOrdersForUser,
  requestReturn,
  trackOrder,
} from '../../services/order.service.js';
import {
  cancelOrderBody,
  idParams,
  orderListQuery,
  returnOrderBody,
  trackParams,
  trackQuery,
} from '../../validators/auth.schema.js';

/** `/me/orders` — mounted under the authenticated `/me` router. */
export const meOrdersRouter: Router = Router();

meOrdersRouter.use(requireAuth);

/** GET /me/orders */
meOrdersRouter.get('/', validate({ query: orderListQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as { page: number; limit: number; status?: string };
    const { items, total } = await listOrdersForUser(req.session!.id, query);
    res.json(ok(items, paginationMeta(query.page, query.limit, total)));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /me/orders/:id
 *
 * The ownership filter is the whole security control. Do not "optimise" this
 * into a fetch-then-compare — that pattern is how IDOR bugs get reintroduced.
 */
meOrdersRouter.get('/:id', validate({ params: idParams }), async (req, res, next) => {
  try {
    const { id } = req.params as { id: string };
    const order = await getOrderForUser(req.session!.id, id);
    if (!order) throw notFound('Order');
    res.json(ok(order));
  } catch (error) {
    next(error);
  }
});

/** POST /me/orders/:id/cancel — refused once the order has shipped. */
meOrdersRouter.post(
  '/:id/cancel',
  csrfProtection,
  validate({ params: idParams, body: cancelOrderBody }),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason?: string };

      // Ownership first: a foreign order must 404 before any status logic runs,
      // or the error message would leak the order's current status.
      const owned = await getOrderForUser(req.session!.id, id);
      if (!owned) throw notFound('Order');

      const order = await cancelOrder(id, {
        reason,
        changedBy: req.session!.id,
        byCustomer: true,
      });

      res.json(ok(order));
    } catch (error) {
      next(error);
    }
  },
);

/** POST /me/orders/:id/return — only from DELIVERED. */
meOrdersRouter.post(
  '/:id/return',
  csrfProtection,
  validate({ params: idParams, body: returnOrderBody }),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as { reason: string; itemIds?: string[] };

      const owned = await getOrderForUser(req.session!.id, id);
      if (!owned) throw notFound('Order');

      const order = await requestReturn(id, body, req.session!.id);
      res.json(ok(order));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Public tracking ─────────────────────────────────────────────────────

export const trackRouter: Router = Router();

/**
 * GET /track/:orderNumber?phone=01XXXXXXXXX
 *
 * Public, but requires **both** the order number and the phone on the order.
 * Either alone is a 404 — the response never reveals that the order number is
 * real but the phone is wrong.
 */
trackRouter.get(
  '/:orderNumber',
  validate({ params: trackParams, query: trackQuery }),
  async (req, res, next) => {
    try {
      const { orderNumber } = req.params as { orderNumber: string };
      const { phone } = req.query as unknown as { phone: string };

      const order = await trackOrder(orderNumber, phone);
      if (!order) throw notFound('Order');

      /**
       * Tracking is a public surface, so it returns a reduced view: no internal
       * id, no payment transaction id, no customer email. The customer needs
       * the status, the items and the courier — nothing that helps an attacker.
       */
      res.json(
        ok({
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          createdAt: order.createdAt,
          totalAmountPoisha: order.totalAmountPoisha,
          items: order.items.map((item) => ({
            nameEn: item.nameEn,
            nameBn: item.nameBn,
            quantity: item.quantity,
            lineTotalPoisha: item.lineTotalPoisha,
          })),
          statusHistory: order.statusHistory,
          courierName: order.courierName,
          consignmentId: order.consignmentId,
          trackingUrl: order.trackingUrl,
          shippingAddress: order.shippingAddress
            ? {
                recipientName: order.shippingAddress.recipientName,
                division: order.shippingAddress.division,
                district: order.shippingAddress.district,
                area: order.shippingAddress.area,
              }
            : null,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
