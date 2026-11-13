/**
 * `/api/v1/admin/brands` — the brand module of the admin panel.
 *
 * Same mounting contract as `categories.ts`: rate limit, auth and the staff gate
 * live on `adminRouter`; this router adds only `requirePermission`.
 *
 * ── No `/:id` collision ─────────────────────────────────────────────────────
 *
 * `/reorder` is a POST on the collection root, not on a member, because brands
 * have no parent — the group is every brand, so there is no anchor row to name.
 * That keeps `/:id` free of a static sibling.
 *
 * ── The delete flag ─────────────────────────────────────────────────────────
 *
 * `?detach=true` is the operator accepting that the brand's products lose their
 * brand. It is a query parameter rather than a body because DELETE bodies are
 * not reliably forwarded by proxies, and a silently dropped body would turn
 * "detach these 12 products" into "refuse" — or worse, into a delete that
 * relied on the FK's `SET NULL` without anyone having said so.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  activeBody,
  adminBrandListQuery,
  brandCreateBody,
  brandDeleteQuery,
  brandIdParams,
  brandUpdateBody,
  reorderBody,
} from '../../validators/adminCatalog.schema.js';
import {
  createBrand,
  deleteBrand,
  getBrand,
  listBrands,
  reorderBrands,
  setBrandActive,
  updateBrand,
  type Actor,
} from './brand.service.js';

export const brandsRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

// ─── Reorder (static path, declared before /:id) ────────────────────────────

/**
 * POST /reorder — `{ orderedIds }`, every brand in its new order.
 *
 * Declared before `/:id` because `reorder` is a static segment in a position
 * where `/:id` also matches. Same footgun the reviews router documents.
 */
brandsRouter.post(
  '/reorder',
  requirePermission('catalog:write'),
  validate({ body: reorderBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { orderedIds: string[] };
      res.json(ok(await reorderBrands(body.orderedIds, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── List ───────────────────────────────────────────────────────────────────

brandsRouter.get(
  '/',
  requirePermission('catalog:read'),
  validate({ query: adminBrandListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listBrands>[0];
      res.json(ok(await listBrands(query)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Detail ─────────────────────────────────────────────────────────────────

brandsRouter.get(
  '/:id',
  requirePermission('catalog:read'),
  validate({ params: brandIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getBrand(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Create ─────────────────────────────────────────────────────────────────

brandsRouter.post(
  '/',
  requirePermission('catalog:write'),
  validate({ body: brandCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createBrand>[0];
      res.status(201).json(ok(await createBrand(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Update ─────────────────────────────────────────────────────────────────

brandsRouter.patch(
  '/:id',
  requirePermission('catalog:write'),
  validate({ params: brandIdParams, body: brandUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateBrand>[1];
      res.json(ok(await updateBrand(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Active toggle ──────────────────────────────────────────────────────────

brandsRouter.post(
  '/:id/active',
  requirePermission('catalog:write'),
  validate({ params: brandIdParams, body: activeBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { isActive: boolean };
      res.json(ok(await setBrandActive(req.params.id!, body.isActive, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Delete ─────────────────────────────────────────────────────────────────

/**
 * DELETE /:id — `?detach=true` to null the brand on its products.
 *
 * Without the flag a brand with products is a 409 `BRAND_IN_USE`. With it, the
 * response carries `affectedCount` so the screen can say how many products were
 * left without a brand.
 */
brandsRouter.delete(
  '/:id',
  requirePermission('catalog:write'),
  validate({ params: brandIdParams, query: brandDeleteQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { detach: 'true' | 'false' };
      res.json(
        ok(await deleteBrand(req.params.id!, { detach: query.detach === 'true' }, actorFrom(req))),
      );
    } catch (error) {
      next(error);
    }
  },
);
