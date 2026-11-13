/**
 * `/api/v1/admin/suppliers` — Phase 10 pass D.
 *
 * Permission is `inventory:*`: suppliers exist to put stock on shelves, and the
 * matrix already gives that to INVENTORY_STAFF and above. Using `catalog:*` would
 * let a marketing user edit procurement, which is not their job.
 *
 * `/:id/products/:productId` is a two-segment member path; it is declared before
 * `/:id` only in the sense that Express matches by specificity of the pattern,
 * not declaration order, for different segment counts — so the order here is for
 * readability, not correctness.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  adminSupplierListQuery,
  supplierActiveBody,
  supplierCreateBody,
  supplierIdParams,
  supplierProductBody,
  supplierProductParams,
  supplierUpdateBody,
} from '../../validators/adminSupplier.schema.js';
import {
  addSupplierProduct,
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  removeSupplierProduct,
  setSupplierActive,
  updateSupplier,
  type Actor,
} from './supplier.service.js';

export const suppliersRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

suppliersRouter.get(
  '/',
  requirePermission('inventory:read'),
  validate({ query: adminSupplierListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listSuppliers>[0];
      res.json(ok(await listSuppliers(query)));
    } catch (error) {
      next(error);
    }
  },
);

suppliersRouter.post(
  '/',
  requirePermission('inventory:write'),
  validate({ body: supplierCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createSupplier>[0];
      res.status(201).json(ok(await createSupplier(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

suppliersRouter.get(
  '/:id',
  requirePermission('inventory:read'),
  validate({ params: supplierIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getSupplier(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

suppliersRouter.patch(
  '/:id',
  requirePermission('inventory:write'),
  validate({ params: supplierIdParams, body: supplierUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateSupplier>[1];
      res.json(ok(await updateSupplier(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

suppliersRouter.post(
  '/:id/active',
  requirePermission('inventory:write'),
  validate({ params: supplierIdParams, body: supplierActiveBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { isActive: boolean };
      res.json(ok(await setSupplierActive(req.params.id!, body.isActive, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

suppliersRouter.delete(
  '/:id',
  requirePermission('inventory:write'),
  validate({ params: supplierIdParams }),
  async (req, res, next) => {
    try {
      await deleteSupplier(req.params.id!, actorFrom(req));
      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Supplied products ─────────────────────────────────────────────────────

suppliersRouter.post(
  '/:id/products',
  requirePermission('inventory:write'),
  validate({ params: supplierIdParams, body: supplierProductBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof addSupplierProduct>[1];
      await addSupplierProduct(req.params.id!, body, actorFrom(req));
      res.status(201).json(ok(await getSupplier(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

suppliersRouter.delete(
  '/:id/products/:productId',
  requirePermission('inventory:write'),
  validate({ params: supplierProductParams }),
  async (req, res, next) => {
    try {
      await removeSupplierProduct(req.params.id!, req.params.productId!, actorFrom(req));
      res.json(ok({ removed: true }));
    } catch (error) {
      next(error);
    }
  },
);
