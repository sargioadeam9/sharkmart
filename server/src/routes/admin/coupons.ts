/**
 * `/api/v1/admin/coupons` — Phase 10 pass A.
 *
 * Mounting contract is the same as every other admin module: rate limit, auth and
 * the staff gate live on `adminRouter`; this router adds only `requirePermission`.
 *
 * ── Route order ─────────────────────────────────────────────────────────────
 *
 * `/counts` is declared before `/:id`, because Express matches in declaration
 * order and `counts` would otherwise be parsed as a coupon id and 422 on the uuid
 * check. `/active-offers` is not a route here: the state filter on the list
 * (`?state=live`) is the active-offers overview, and a second endpoint returning
 * the same rows is how two screens start disagreeing.
 *
 * ── Delete ──────────────────────────────────────────────────────────────────
 *
 * There is a DELETE, but it only succeeds for a coupon that has never been used.
 * Anything else gets a 409 that names the counts and says to deactivate. See the
 * header of `coupon.service.ts` for why the FK's SET NULL is not a substitute.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  adminCouponListQuery,
  couponActiveBody,
  couponCreateBody,
  couponIdParams,
  couponRedemptionQuery,
  couponUpdateBody,
} from '../../validators/adminCoupon.schema.js';
import {
  couponCounts,
  couponRedemptions,
  createCoupon,
  deleteCoupon,
  getCoupon,
  listCoupons,
  setCouponActive,
  updateCoupon,
  type Actor,
} from './coupon.service.js';

export const couponsRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

// ─── Counts (static path, before /:id) ──────────────────────────────────────

couponsRouter.get('/counts', requirePermission('marketing:read'), async (_req, res, next) => {
  try {
    res.json(ok(await couponCounts()));
  } catch (error) {
    next(error);
  }
});

// ─── List ───────────────────────────────────────────────────────────────────

couponsRouter.get(
  '/',
  requirePermission('marketing:read'),
  validate({ query: adminCouponListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listCoupons>[0];
      res.json(ok(await listCoupons(query)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Create ─────────────────────────────────────────────────────────────────

couponsRouter.post(
  '/',
  requirePermission('marketing:write'),
  validate({ body: couponCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createCoupon>[0];
      res.status(201).json(ok(await createCoupon(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Detail ─────────────────────────────────────────────────────────────────

couponsRouter.get(
  '/:id',
  requirePermission('marketing:read'),
  validate({ params: couponIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getCoupon(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Update ─────────────────────────────────────────────────────────────────

couponsRouter.patch(
  '/:id',
  requirePermission('marketing:write'),
  validate({ params: couponIdParams, body: couponUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateCoupon>[1];
      res.json(ok(await updateCoupon(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Activate / deactivate ──────────────────────────────────────────────────

couponsRouter.post(
  '/:id/active',
  requirePermission('marketing:write'),
  validate({ params: couponIdParams, body: couponActiveBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { isActive: boolean };
      res.json(ok(await setCouponActive(req.params.id!, body.isActive, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Redemption report ──────────────────────────────────────────────────────

couponsRouter.get(
  '/:id/redemptions',
  requirePermission('marketing:read'),
  validate({ params: couponIdParams, query: couponRedemptionQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { page: number; limit: number };
      res.json(ok(await couponRedemptions(req.params.id!, query.page, query.limit)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Delete (unused only) ───────────────────────────────────────────────────

couponsRouter.delete(
  '/:id',
  requirePermission('marketing:write'),
  validate({ params: couponIdParams }),
  async (req, res, next) => {
    try {
      await deleteCoupon(req.params.id!, actorFrom(req));
      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  },
);
