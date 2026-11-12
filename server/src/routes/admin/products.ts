/**
 * `/api/v1/admin/products` — the products module of the admin panel.
 *
 * ── What this router does NOT do ────────────────────────────────────────────
 *
 * It does not apply `rateLimit`, `requireAuth` or the staff gate. Those are
 * mounted once on `adminRouter` (routes/admin/index.ts:30-54) and this router is
 * a sub-router of it. Re-applying them here would double-count the rate-limit
 * bucket and make the auth chain look like it lives in two places, which is how
 * a future route ends up with only one of them.
 *
 * What it DOES apply is `requirePermission` on every route — that is the
 * per-route decision, and it is the one the sidebar reads too.
 *
 * ── Route order matters ─────────────────────────────────────────────────────
 *
 * `GET /form-options` is declared before `GET /:id`. Express matches in
 * declaration order, so with `/:id` first, a request for `/form-options` would
 * be parsed as a product id and 422 on the uuid check. This is the classic
 * Express footgun and it is why the static route is first.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok, paginationMeta } from '../../types/api.js';
import {
  adminProductCreateBody,
  adminProductListQuery,
  adminProductUpdateBody,
  productIdParams,
  productImageCreateBody,
  productImageParams,
  productImageReorderBody,
  productImageUpdateBody,
  productVariantParams,
  publishBody,
  variantCreateBody,
  variantUpdateBody,
} from '../../validators/adminProduct.schema.js';
import {
  addProductImage,
  archiveAdminProduct,
  createAdminProduct,
  createProductVariant,
  deleteAdminProduct,
  deleteProductImage,
  deleteProductVariant,
  getAdminProduct,
  listAdminProducts,
  productFormOptions,
  reorderProductImages,
  setProductPublished,
  updateAdminProduct,
  updateProductImage,
  updateProductVariant,
  type Actor,
} from './product.service.js';

export const productsRouter: Router = Router();

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

// ─── Form options (static, before /:id) ────────────────────────────────────

/**
 * GET /form-options — categories and brands for the product form's selects.
 *
 * Read-only dependency, not the Categories/Brands module. Gated on
 * `catalog:read` because it is catalog reference data.
 */
productsRouter.get('/form-options', requirePermission('catalog:read'), async (_req, res, next) => {
  try {
    res.json(ok(await productFormOptions()));
  } catch (error) {
    next(error);
  }
});

// ─── List ──────────────────────────────────────────────────────────────────

productsRouter.get(
  '/',
  requirePermission('catalog:read'),
  validate({ query: adminProductListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listAdminProducts>[0];
      const result = await listAdminProducts(query);

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

// ─── Create ────────────────────────────────────────────────────────────────

productsRouter.post(
  '/',
  requirePermission('catalog:write'),
  validate({ body: adminProductCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createAdminProduct>[0];
      const product = await createAdminProduct(body, actorFrom(req));
      res.status(201).json(ok(product));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Detail ────────────────────────────────────────────────────────────────

productsRouter.get(
  '/:id',
  requirePermission('catalog:read'),
  validate({ params: productIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await getAdminProduct(req.params.id!)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Update ────────────────────────────────────────────────────────────────

productsRouter.patch(
  '/:id',
  requirePermission('catalog:write'),
  validate({ params: productIdParams, body: adminProductUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateAdminProduct>[1];
      res.json(ok(await updateAdminProduct(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Publish / archive / delete ────────────────────────────────────────────

productsRouter.post(
  '/:id/publish',
  requirePermission('catalog:write'),
  validate({ params: productIdParams, body: publishBody }),
  async (req, res, next) => {
    try {
      const { publish } = req.body as { publish: boolean };
      res.json(ok(await setProductPublished(req.params.id!, publish, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

productsRouter.post(
  '/:id/archive',
  requirePermission('catalog:write'),
  validate({ params: productIdParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await archiveAdminProduct(req.params.id!, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

productsRouter.delete(
  '/:id',
  requirePermission('catalog:write'),
  validate({ params: productIdParams }),
  async (req, res, next) => {
    try {
      await deleteAdminProduct(req.params.id!, actorFrom(req));
      res.json(ok({ deleted: true, id: req.params.id }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Images ────────────────────────────────────────────────────────────────

productsRouter.post(
  '/:id/images',
  requirePermission('catalog:write'),
  validate({ params: productIdParams, body: productImageCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof addProductImage>[1];
      res.status(201).json(ok(await addProductImage(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Reorder is declared before `/:imageId` for the same reason `/form-options` is
 * before `/:id`: `reorder` is a static segment in a position where a parameter
 * pattern also matches.
 */
productsRouter.patch(
  '/:id/images/reorder',
  requirePermission('catalog:write'),
  validate({ params: productIdParams, body: productImageReorderBody }),
  async (req, res, next) => {
    try {
      const { imageIds } = req.body as { imageIds: string[] };
      res.json(ok(await reorderProductImages(req.params.id!, imageIds, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

productsRouter.patch(
  '/:id/images/:imageId',
  requirePermission('catalog:write'),
  validate({ params: productImageParams, body: productImageUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateProductImage>[2];
      res.json(
        ok(await updateProductImage(req.params.id!, req.params.imageId!, body, actorFrom(req))),
      );
    } catch (error) {
      next(error);
    }
  },
);

productsRouter.delete(
  '/:id/images/:imageId',
  requirePermission('catalog:write'),
  validate({ params: productImageParams }),
  async (req, res, next) => {
    try {
      res.json(ok(await deleteProductImage(req.params.id!, req.params.imageId!, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Variants ──────────────────────────────────────────────────────────────

productsRouter.post(
  '/:id/variants',
  requirePermission('catalog:write'),
  validate({ params: productIdParams, body: variantCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createProductVariant>[1];
      res.status(201).json(ok(await createProductVariant(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

productsRouter.patch(
  '/:id/variants/:variantId',
  requirePermission('catalog:write'),
  validate({ params: productVariantParams, body: variantUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateProductVariant>[2];
      res.json(
        ok(
          await updateProductVariant(req.params.id!, req.params.variantId!, body, actorFrom(req)),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

productsRouter.delete(
  '/:id/variants/:variantId',
  requirePermission('catalog:write'),
  validate({ params: productVariantParams }),
  async (req, res, next) => {
    try {
      res.json(
        ok(await deleteProductVariant(req.params.id!, req.params.variantId!, actorFrom(req))),
      );
    } catch (error) {
      next(error);
    }
  },
);
