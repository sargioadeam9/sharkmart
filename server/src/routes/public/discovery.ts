/**
 * `/api/v1/search`, `/api/v1/flash-sale`, `/api/v1/homepage`, `/api/v1/landing/:slug`.
 *
 * Search gets its own tighter rate limit (30/min vs 100/min) because a
 * `contains` scan over two name columns is the most expensive public query in
 * the catalog — security.md §3 puts it in its own bucket for that reason.
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit, LIMITS } from '../../middleware/rateLimiter.js';
import { ok, paginationMeta } from '../../types/api.js';
import { notFound } from '../../middleware/errorHandler.js';
import { cached, TTL } from '../../services/cache.js';
import { listProducts } from '../../services/product.service.js';
import { getFlashSale, getHomepage } from '../../services/homepage.service.js';
import { prisma } from '../../config/database.js';
import { landingParams, searchQuery } from '../../validators/catalog.schema.js';

export const searchRouter: Router = Router();

/**
 * GET /api/v1/search?q=
 *
 * Bilingual: the query matches `nameEn`, `nameBn`, SKU, brand name and category
 * name. A Bangla query finds Bangla products and an English query finds the
 * same product through its English name — the two scripts are separate columns,
 * so both are searched.
 */
searchRouter.get(
  '/',
  rateLimit(LIMITS.search),
  validate({ query: searchQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { q: string; page: number; limit: number };

      const result = await cached(
        `search:${query.q}:${query.page}:${query.limit}`,
        TTL.products,
        ['products'],
        () => listProducts({ q: query.q, page: query.page, limit: query.limit }),
      );

      res.json(ok(result.items, paginationMeta(query.page, query.limit, result.total)));
    } catch (error) {
      next(error);
    }
  },
);

export const flashSaleRouter: Router = Router();

/** GET /api/v1/flash-sale — only products inside a live window, plus the countdown target. */
flashSaleRouter.get('/', rateLimit(LIMITS.api), async (_req, res, next) => {
  try {
    /**
     * Cached for 60s, not longer: the window can end mid-cache, and serving an
     * expired sale is worse than an extra query.
     */
    const sale = await cached('flash-sale:active', TTL.flashSale, ['flash-sale', 'products'], () =>
      getFlashSale(),
    );

    res.json(ok(sale, paginationMeta(1, sale.items.length, sale.items.length)));
  } catch (error) {
    next(error);
  }
});

export const homepageRouter: Router = Router();

/** GET /api/v1/homepage — every section in ONE response. */
homepageRouter.get('/', rateLimit(LIMITS.api), async (_req, res, next) => {
  try {
    const aggregate = await cached('homepage:aggregate', TTL.homepage, ['homepage', 'products'], () =>
      getHomepage(),
    );
    res.json(ok(aggregate));
  } catch (error) {
    next(error);
  }
});

export const landingRouter: Router = Router();

/**
 * GET /api/v1/landing/:slug
 *
 * A landing page is a campaign page pointing at one product. Inactive or
 * unknown slugs 404 — a campaign that has been switched off must not keep
 * selling.
 */
landingRouter.get(
  '/:slug',
  rateLimit(LIMITS.api),
  validate({ params: landingParams }),
  async (req, res, next) => {
    try {
      const { slug } = req.params as unknown as { slug: string };

      const page = await cached(`landing:${slug}`, TTL.landing, ['products'], () =>
        prisma.landingPage.findFirst({
          where: { slug, isActive: true },
          select: {
            id: true,
            slug: true,
            title: true,
            campaignName: true,
            content: true,
            productId: true,
            createdAt: true,
          },
        }),
      );

      if (!page) throw notFound('Landing page');

      res.json(ok(page));
    } catch (error) {
      next(error);
    }
  },
);
