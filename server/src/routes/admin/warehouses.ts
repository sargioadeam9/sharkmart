/**
 * `/api/v1/admin/warehouses` — Phase 10 pass E.
 *
 * `/transfers` is a static path on the collection root rather than a member route:
 * a transfer names two warehouses and a product, so there is no single warehouse
 * it belongs to. Declared before `/:id` because Express matches in declaration
 * order and `transfers` would otherwise be read as a warehouse id.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  createTransfer,
  createWarehouse,
  listTransfers,
  listWarehouses,
  setDefaultWarehouse,
  updateWarehouse,
  warehouseStock,
  type Actor,
} from './warehouse.service.js';

export const warehousesRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

const warehouseIdParams = z.object({ id: z.string().uuid() }).strict();

const warehouseCreateBody = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(120),
    address: z.string().trim().max(400).nullable().optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();

const warehouseUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(400).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

const stockQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const transferQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const transferBody = z
  .object({
    fromWarehouseId: z.string().uuid(),
    toWarehouseId: z.string().uuid(),
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().min(1),
  })
  .strict();

// ─── Static paths first ────────────────────────────────────────────────────

warehousesRouter.get(
  '/transfers',
  requirePermission('inventory:read'),
  validate({ query: transferQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { page: number; limit: number };
      res.json(ok(await listTransfers(query.page, query.limit)));
    } catch (error) {
      next(error);
    }
  },
);

warehousesRouter.post(
  '/transfers',
  requirePermission('inventory:write'),
  validate({ body: transferBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createTransfer>[0];
      res.status(201).json(ok(await createTransfer(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

warehousesRouter.get('/', requirePermission('inventory:read'), async (_req, res, next) => {
  try {
    res.json(ok({ warehouses: await listWarehouses() }));
  } catch (error) {
    next(error);
  }
});

warehousesRouter.post(
  '/',
  requirePermission('inventory:write'),
  validate({ body: warehouseCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createWarehouse>[0];
      res.status(201).json(ok(await createWarehouse(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

warehousesRouter.patch(
  '/:id',
  requirePermission('inventory:write'),
  validate({ params: warehouseIdParams, body: warehouseUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateWarehouse>[1];
      res.json(ok(await updateWarehouse(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

warehousesRouter.post(
  '/:id/default',
  requirePermission('inventory:write'),
  validate({ params: warehouseIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok({ warehouses: await setDefaultWarehouse(req.params.id!, actorFrom(req)) }));
    } catch (error) {
      next(error);
    }
  },
);

warehousesRouter.get(
  '/:id/stock',
  requirePermission('inventory:read'),
  validate({ params: warehouseIdParams, query: stockQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { page: number; limit: number };
      res.json(ok(await warehouseStock(req.params.id!, query.page, query.limit)));
    } catch (error) {
      next(error);
    }
  },
);
