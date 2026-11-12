/**
 * `/api/v1/categories` and `/api/v1/brands`.
 *
 * Categories are cached 10 minutes (backend.md), brands the same — both change
 * only when an admin edits them.
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit, LIMITS } from '../../middleware/rateLimiter.js';
import { ok, paginationMeta } from '../../types/api.js';
import { notFound } from '../../middleware/errorHandler.js';
import { cached, TTL } from '../../services/cache.js';
import {
  getBrandBySlug,
  getCategoryBySlug,
  listBrands,
  listCategories,
} from '../../services/category.service.js';
import { listProducts } from '../../services/product.service.js';
import { categoryProductsQuery, slugParams } from '../../validators/catalog.schema.js';

export const categoriesRouter: Router = Router();

/** GET /api/v1/categories — the full tree with counts. */
categoriesRouter.get('/', rateLimit(LIMITS.api), async (_req, res, next) => {
  try {
    const categories = await cached('categories:tree', TTL.categories, ['categories'], () =>
      listCategories(),
    );
    res.json(ok(categories, paginationMeta(1, categories.length, categories.length)));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/categories/:slug — the category plus its products.
 *
 * The products come from the same `listProducts` the listing endpoint uses, so
 * a category page and a filtered listing can never disagree.
 */
categoriesRouter.get(
  '/:slug',
  rateLimit(LIMITS.api),
  validate({ params: slugParams, query: categoryProductsQuery }),
  async (req, res, next) => {
    try {
      const { slug } = req.params as unknown as { slug: string };
      const query = req.query as unknown as {
        page: number;
        limit: number;
        sort: 'relevance' | 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'rating';
      };

      const category = await cached(`category:${slug}`, TTL.categories, ['categories'], () =>
        getCategoryBySlug(slug),
      );
      if (!category) throw notFound('Category');

      const products = await cached(
        `category-products:${slug}:${query.page}:${query.limit}:${query.sort}`,
        TTL.products,
        ['products'],
        () => listProducts({ ...query, category: slug }),
      );

      res.json({
        success: true,
        data: { category, products: products.items },
        meta: paginationMeta(query.page, query.limit, products.total),
      });
    } catch (error) {
      next(error);
    }
  },
);

export const brandsRouter: Router = Router();

/** GET /api/v1/brands — every active brand with its product count. */
brandsRouter.get('/', rateLimit(LIMITS.api), async (_req, res, next) => {
  try {
    const brands = await cached('brands:all', TTL.categories, ['brands'], () => listBrands());
    res.json(ok(brands, paginationMeta(1, brands.length, brands.length)));
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/brands/:slug — the brand plus its products. */
brandsRouter.get(
  '/:slug',
  rateLimit(LIMITS.api),
  validate({ params: slugParams, query: categoryProductsQuery }),
  async (req, res, next) => {
    try {
      const { slug } = req.params as unknown as { slug: string };
      const query = req.query as unknown as {
        page: number;
        limit: number;
        sort: 'relevance' | 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'rating';
      };

      const brand = await cached(`brand:${slug}`, TTL.categories, ['brands'], () =>
        getBrandBySlug(slug),
      );
      if (!brand) throw notFound('Brand');

      const products = await cached(
        `brand-products:${slug}:${query.page}:${query.limit}:${query.sort}`,
        TTL.products,
        ['products'],
        () => listProducts({ ...query, brand: slug }),
      );

      res.json({
        success: true,
        data: { brand, products: products.items },
        meta: paginationMeta(query.page, query.limit, products.total),
      });
    } catch (error) {
      next(error);
    }
  },
);
