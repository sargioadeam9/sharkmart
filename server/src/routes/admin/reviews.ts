/**
 * `/api/v1/admin/reviews` — the reviews module of the admin panel.
 *
 * ── What this router does NOT do ─────────────────────────────────────────────
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
 * ── Route order matters ──────────────────────────────────────────────────────
 *
 * `/counts` and `/bulk` are declared before `/:id`. Express matches in
 * declaration order, so with `/:id` first a request for `/counts` would be
 * parsed as a review id and 422 on the uuid check. Same footgun the products and
 * inventory routers document.
 *
 * ── The permission split ─────────────────────────────────────────────────────
 *
 * `reviews:read` is held by INVENTORY_STAFF, MARKETING_STAFF, ORDER_MANAGER,
 * ADMIN and SUPER_ADMIN. `reviews:moderate` is held by MARKETING_STAFF and
 * above — INVENTORY_STAFF can read the queue and cannot act on it.
 *
 * That is not an oversight and it is tested: a warehouse clerk needs to know a
 * product is being review-bombed, and does not get to decide what the public
 * reads. The API enforces it; the screen hides the buttons for the same reason
 * the nav hides the module.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok, paginationMeta } from '../../types/api.js';
import {
  adminReviewListQuery,
  reviewBulkBody,
  reviewIdParams,
} from '../../validators/adminReview.schema.js';
import {
  approveReview,
  bulkModerate,
  deleteReview,
  getReview,
  listReviews,
  rejectReview,
  reviewCounts,
  toggleFlag,
  type Actor,
} from './review.service.js';

export const reviewsRouter: Router = Router();

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

// ─── Counts (static, before /:id) ───────────────────────────────────────────

/**
 * GET /counts — the five tab badges.
 *
 * Computed server-side so the browser never counts. A client-side count over one
 * page of twenty would report "3 pending" for a queue of forty.
 */
reviewsRouter.get('/counts', requirePermission('reviews:read'), async (_req, res, next) => {
  try {
    res.json(ok(await reviewCounts()));
  } catch (error) {
    next(error);
  }
});

// ─── Bulk (static, before /:id) ─────────────────────────────────────────────

/**
 * POST /bulk — the sticky bulk bar's action.
 *
 * Declared before `/:id` for the same reason `/counts` is: `bulk` is a static
 * segment in a position where `/:id` also matches.
 */
reviewsRouter.post(
  '/bulk',
  requirePermission('reviews:moderate'),
  validate({ body: reviewBulkBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof bulkModerate>[0];
      res.json(ok(await bulkModerate(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── List ───────────────────────────────────────────────────────────────────

reviewsRouter.get(
  '/',
  requirePermission('reviews:read'),
  validate({ query: adminReviewListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listReviews>[0];
      const result = await listReviews(query);

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

// ─── Detail ─────────────────────────────────────────────────────────────────

reviewsRouter.get(
  '/:id',
  requirePermission('reviews:read'),
  validate({ params: reviewIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getReview(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Moderation ─────────────────────────────────────────────────────────────

/** POST /:id/approve — makes the review visible on the storefront. */
reviewsRouter.post(
  '/:id/approve',
  requirePermission('reviews:moderate'),
  validate({ params: reviewIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await approveReview(req.params.id!, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /:id/reject — hides it, and stamps `moderatedAt` so it leaves the pending
 * queue instead of returning to it. That is the whole reason the column exists.
 */
reviewsRouter.post(
  '/:id/reject',
  requirePermission('reviews:moderate'),
  validate({ params: reviewIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await rejectReview(req.params.id!, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

/** POST /:id/flag — toggles the moderator's bookmark. Not a moderation decision. */
reviewsRouter.post(
  '/:id/flag',
  requirePermission('reviews:moderate'),
  validate({ params: reviewIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await toggleFlag(req.params.id!, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /:id — hard delete, media cascades.
 *
 * `reviews:moderate`, not a separate `reviews:delete`: the people who may hide a
 * review are the people who may remove it, and a fourth permission would be a
 * distinction nobody asked for.
 */
reviewsRouter.delete(
  '/:id',
  requirePermission('reviews:moderate'),
  validate({ params: reviewIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await deleteReview(req.params.id!, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);
