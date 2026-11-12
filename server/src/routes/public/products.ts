/**
 * `/api/v1/products` — listing, slugs, detail.
 *
 * Every handler is thin: validate (middleware), delegate to a service, wrap in
 * the envelope. No business logic and no Prisma here, which is what keeps the
 * service testable without a request.
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit, LIMITS } from '../../middleware/rateLimiter.js';
import { ok, paginationMeta } from '../../types/api.js';
import { notFound } from '../../middleware/errorHandler.js';
import { cached, TTL } from '../../services/cache.js';
import {
  getProductBySlug,
  listProductSlugs,
  listProducts,
} from '../../services/product.service.js';
import { productListQuery, slugParams, slugsQuery } from '../../validators/catalog.schema.js';

export const productsRouter: Router = Router();

/**
 * GET /api/v1/products
 *
 * Filters: category, brand, q, min/max price, inStockOnly, onDiscountOnly,
 * ratingMin. Sort: relevance | newest | popular | price_asc | price_desc |
 * rating. Paginated.
 */
productsRouter.get(
  '/',
  rateLimit(LIMITS.api),
  validate({ query: productListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listProducts>[0];

      /**
       * The cache key is the normalised query, so `?page=1&limit=20` and
       * `?limit=20&page=1` share one entry. Sorted keys, not raw query order.
       */
      const key = `products:${JSON.stringify(
        Object.keys(query)
          .sort()
          .map((k) => [k, (query as unknown as Record<string, unknown>)[k]]),
      )}`;

      const result = await cached(key, TTL.products, ['products'], () => listProducts(query));

      res.json(ok(result.items, paginationMeta(query.page, query.limit, result.total)));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/products/slugs?limit=200
 *
 * The slug list for `generateStaticParams`. Declared BEFORE `/:slug` so
 * "slugs" is not swallowed as a product slug.
 */
productsRouter.get(
  '/slugs',
  rateLimit(LIMITS.api),
  validate({ query: slugsQuery }),
  async (req, res, next) => {
    try {
      const { limit } = req.query as unknown as { limit: number };
      const slugs = await cached(`product-slugs:${limit}`, TTL.products, ['products'], () =>
        listProductSlugs(limit),
      );
      res.json(ok(slugs, { page: 1, limit, total: slugs.length }));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/products/:slug
 *
 * Full detail: images, variants, specs, details, approved reviews, related ids.
 * An unknown slug is a 404 with the envelope, never a 500.
 */
productsRouter.get(
  '/:slug',
  rateLimit(LIMITS.api),
  validate({ params: slugParams }),
  async (req, res, next) => {
    try {
      const { slug } = req.params as unknown as { slug: string };

      const detail = await cached(`product:${slug}`, TTL.product, ['products'], () =>
        getProductBySlug(slug),
      );

      if (!detail) throw notFound('Product');

      res.json(ok(detail));
    } catch (error) {
      next(error);
    }
  },
);
