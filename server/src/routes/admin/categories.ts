/**
 * `/api/v1/admin/categories` — the category module of the admin panel.
 *
 * ── What this router does NOT do ────────────────────────────────────────────
 *
 * It does not apply `rateLimit`, `requireAuth` or the staff gate. Those are
 * mounted once on `adminRouter` (routes/admin/index.ts) and this router is a
 * sub-router of it. Re-applying them here would double-count the rate-limit
 * bucket and make the auth chain look like it lives in two places, which is how
 * a future route ends up with only one of them.
 *
 * What it DOES apply is `requirePermission` on every route.
 *
 * ── Route order matters ─────────────────────────────────────────────────────
 *
 * There is no static segment here that collides with `/:id` — `/categories` has
 * no `/counts` or `/bulk` equivalent — so `/:id` can be declared with the rest.
 * If a static route is ever added, it must go above `/:id`: Express matches in
 * declaration order, and a uuid param schema would 422 on a word.
 *
 * ── The permission split ────────────────────────────────────────────────────
 *
 * `catalog:read` and `catalog:write` are held by INVENTORY_STAFF, MARKETING_STAFF
 * and above. Both staff roles can edit categories and brands. That is correct,
 * not a bug: the catalog is the shared surface between the warehouse and
 * marketing, and `security.md` §6 grants both.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  activeBody,
  adminCategoryListQuery,
  categoryCreateBody,
  categoryDeleteQuery,
  categoryIdParams,
  categoryUpdateBody,
  reorderBody,
} from '../../validators/adminCatalog.schema.js';
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  reorderCategories,
  setCategoryActive,
  updateCategory,
  type Actor,
} from './category.service.js';

export const categoriesRouter: Router = Router();

/**
 * The acting user and their IP, for the audit row.
 *
 * `req.ip` is the only honest source — it is the value the rate limiter uses and
 * the one `trust proxy` is configured to make correct behind a load balancer.
 * Reading `X-Forwarded-For` by hand would let a client forge the audit trail.
 */
function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

// ─── List ───────────────────────────────────────────────────────────────────

/**
 * GET / — `?view=tree|flat`, `q`, `active`.
 *
 * `tree` is the default because the screen is a tree. `flat` exists for the
 * picker and for the duplicate-name check: three categories called
 * "Accessories" are only distinguishable side by side, each with its `path`.
 */
categoriesRouter.get(
  '/',
  requirePermission('catalog:read'),
  validate({ query: adminCategoryListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listCategories>[0];
      res.json(ok(await listCategories(query)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Detail ─────────────────────────────────────────────────────────────────

categoriesRouter.get(
  '/:id',
  requirePermission('catalog:read'),
  validate({ params: categoryIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getCategory(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Create ─────────────────────────────────────────────────────────────────

categoriesRouter.post(
  '/',
  requirePermission('catalog:write'),
  validate({ body: categoryCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createCategory>[0];
      res.status(201).json(ok(await createCategory(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Update ─────────────────────────────────────────────────────────────────

categoriesRouter.patch(
  '/:id',
  requirePermission('catalog:write'),
  validate({ params: categoryIdParams, body: categoryUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateCategory>[1];
      res.json(ok(await updateCategory(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Reorder ────────────────────────────────────────────────────────────────

/**
 * POST /:id/reorder — `{ orderedIds }`, the complete sibling group in its new
 * order. `:id` may be any member of the group; the group is its `parentId`.
 */
categoriesRouter.post(
  '/:id/reorder',
  requirePermission('catalog:write'),
  validate({ params: categoryIdParams, body: reorderBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { orderedIds: string[] };
      res.json(ok(await reorderCategories(req.params.id!, body.orderedIds, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Active toggle ──────────────────────────────────────────────────────────

categoriesRouter.post(
  '/:id/active',
  requirePermission('catalog:write'),
  validate({ params: categoryIdParams, body: activeBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { isActive: boolean };
      res.json(ok(await setCategoryActive(req.params.id!, body.isActive, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Delete ─────────────────────────────────────────────────────────────────

/**
 * DELETE /:id — `?reparent=true` to promote children to root.
 *
 * The 409s this can return are the point of the module: `CATEGORY_IN_USE` with
 * the product count, and `CATEGORY_HAS_CHILDREN` with the child names. Both are
 * in `details.reason`; the HTTP code stays `CONFLICT` because `ApiErrorCode` is
 * a closed union shared by every route.
 */
categoriesRouter.delete(
  '/:id',
  requirePermission('catalog:write'),
  validate({ params: categoryIdParams, query: categoryDeleteQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { reparent: 'true' | 'false' };
      res.json(
        ok(
          await deleteCategory(req.params.id!, { reparent: query.reparent === 'true' }, actorFrom(req)),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
