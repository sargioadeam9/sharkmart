/**
 * `/api/v1/admin/purchase-orders` — Phase 10 pass D.
 *
 * A separate mount from `/suppliers` because a purchase order is fetched by its
 * own id and listed across suppliers; nesting it under a supplier would force
 * every screen to know the supplier before it could look at an order.
 *
 * The lifecycle lives in the service: DRAFT → ORDERED → PARTIAL → RECEIVED, with
 * CANCELLED reachable from anything except RECEIVED. Receiving is a delta and is
 * validated as a whole, so a refused request never leaves half a shipment applied.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  adminPurchaseOrderListQuery,
  purchaseOrderCancelBody,
  purchaseOrderCreateBody,
  purchaseOrderIdParams,
  purchaseOrderReceiveBody,
} from '../../validators/adminSupplier.schema.js';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  type Actor,
} from './supplier.service.js';

export const purchaseOrdersRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

purchaseOrdersRouter.get(
  '/',
  requirePermission('inventory:read'),
  validate({ query: adminPurchaseOrderListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listPurchaseOrders>[0];
      res.json(ok(await listPurchaseOrders(query)));
    } catch (error) {
      next(error);
    }
  },
);

purchaseOrdersRouter.post(
  '/',
  requirePermission('inventory:write'),
  validate({ body: purchaseOrderCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createPurchaseOrder>[0];
      res.status(201).json(ok(await createPurchaseOrder(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

purchaseOrdersRouter.get(
  '/:id',
  requirePermission('inventory:read'),
  validate({ params: purchaseOrderIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getPurchaseOrder(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

purchaseOrdersRouter.post(
  '/:id/order',
  requirePermission('inventory:write'),
  validate({ params: purchaseOrderIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await markPurchaseOrderOrdered(req.params.id!, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

purchaseOrdersRouter.post(
  '/:id/receive',
  requirePermission('inventory:write'),
  validate({ params: purchaseOrderIdParams, body: purchaseOrderReceiveBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof receivePurchaseOrder>[1];
      res.json(ok(await receivePurchaseOrder(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

purchaseOrdersRouter.post(
  '/:id/cancel',
  requirePermission('inventory:write'),
  validate({ params: purchaseOrderIdParams, body: purchaseOrderCancelBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { reason: string };
      res.json(ok(await cancelPurchaseOrder(req.params.id!, body.reason, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);
