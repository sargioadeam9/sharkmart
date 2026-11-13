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
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { cached, TTL } from '../../services/cache.js';
import { listProducts } from '../../services/product.service.js';
import { getFlashSale, getHomepage } from '../../services/homepage.service.js';
import { prisma } from '../../config/database.js';
import { landingParams, landingOrderBody, searchQuery } from '../../validators/catalog.schema.js';

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

      const page = await cached(`landing:${slug}`, TTL.landing, ['landing'], () =>
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

/**
 * POST /api/v1/landing/:slug/order
 *
 * The one-page order form's endpoint. A campaign page points at one product, so
 * the body carries the buyer's details and the quantity — not a price. The price
 * is whatever the product says at the moment of the order, which is why this does
 * not accept one: a landing page that could name its own price is a discount
 * engine nobody audited.
 *
 * The order is recorded as PENDING. It is a lead, not a paid order; converting it
 * into an `Order` is the shop's normal checkout, and pretending otherwise would
 * create a second, unaudited order path.
 */
landingRouter.post(
  '/:slug/order',
  rateLimit(LIMITS.landing),
  validate({ params: landingParams, body: landingOrderBody }),
  async (req, res, next) => {
    try {
      const { slug } = req.params as unknown as { slug: string };
      const body = req.body as { name: string; phone: string; address: string; quantity: number };

      const page = await prisma.landingPage.findFirst({
        where: { slug, isActive: true },
        select: { id: true, productId: true },
      });

      if (!page) throw notFound('Landing page');
      if (!page.productId) {
        throw new HttpError(
          422,
          'VALIDATION_ERROR',
          'This landing page is not linked to a product yet.',
        );
      }

      const product = await prisma.product.findUnique({
        where: { id: page.productId },
        select: { id: true, isPublished: true, isDraft: true },
      });
      if (!product || !product.isPublished || product.isDraft) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'That product is not available.');
      }

      const created = await prisma.landingPageOrder.create({
        data: {
          landingPageId: page.id,
          name: body.name,
          phone: body.phone,
          address: body.address,
          productId: page.productId,
          quantity: body.quantity,
          status: 'PENDING',
        },
        select: { id: true },
      });

      res.status(201).json(ok({ id: created.id, status: 'PENDING' }));
    } catch (error) {
      next(error);
    }
  },
);
