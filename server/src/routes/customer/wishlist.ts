/**
 * `/api/v1/me/wishlist` — the signed-in wishlist.
 *
 * Phase 7 built the guest wishlist on localStorage and marked the merge hook
 * point. This is that merge: `POST /me/wishlist/merge` takes the guest ids and
 * unions them into the server list, without duplicating.
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { csrfProtection } from '../../middleware/session.js';
import { ok } from '../../types/api.js';
import { notFound } from '../../middleware/errorHandler.js';
import { prisma } from '../../config/database.js';
import { wishlistBody, wishlistMergeBody } from '../../validators/auth.schema.js';

export const wishlistRouter: Router = Router();

wishlistRouter.use(requireAuth);

/**
 * GET /me/wishlist
 *
 * Returns the product ids plus enough of each product to render a card, so the
 * wishlist page does not need a second round trip per item.
 */
wishlistRouter.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.wishlist.findMany({
      where: { userId: req.session!.id },
      orderBy: { createdAt: 'desc' },
      select: {
        productId: true,
        createdAt: true,
        product: {
          select: {
            slug: true,
            nameEn: true,
            nameBn: true,
            basePricePoisha: true,
            discountPricePoisha: true,
            images: { where: { isMain: true }, take: 1, select: { url: true } },
            isPublished: true,
            isDraft: true,
          },
        },
      },
    });

    res.json(
      ok(
        rows.map((row) => ({
          productId: row.productId,
          addedAt: row.createdAt.toISOString(),
          slug: row.product.slug,
          nameEn: row.product.nameEn,
          nameBn: row.product.nameBn,
          basePricePoisha: row.product.basePricePoisha,
          discountPricePoisha: row.product.discountPricePoisha,
          imageUrl: row.product.images[0]?.url ?? null,
          available: row.product.isPublished && !row.product.isDraft,
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

/** POST /me/wishlist */
wishlistRouter.post('/', csrfProtection, validate({ body: wishlistBody }), async (req, res, next) => {
  try {
    const { productId } = req.body as { productId: string };

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw notFound('Product');

    // upsert, not create: adding an item already on the list is a no-op, not a
    // unique-constraint error the user has to see.
    await prisma.wishlist.upsert({
      where: { userId_productId: { userId: req.session!.id, productId } },
      create: { userId: req.session!.id, productId },
      update: {},
    });

    res.status(201).json(ok({ productId, added: true }));
  } catch (error) {
    next(error);
  }
});

/** DELETE /me/wishlist/:productId */
wishlistRouter.delete('/:productId', csrfProtection, async (req, res, next) => {
  try {
    const { productId } = req.params as { productId: string };

    // Ownership in the query: deleteMany scoped by userId cannot touch another
    // account's row even if the id is guessed.
    await prisma.wishlist.deleteMany({ where: { userId: req.session!.id, productId } });

    res.json(ok({ productId, removed: true }));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /me/wishlist/merge
 *
 * The Phase 7 hook point. Unions the guest list into the server list.
 *
 * `createMany` with `skipDuplicates` is the whole merge: MySQL's unique index
 * on (userId, productId) makes a duplicate a skip rather than an error, so the
 * operation is idempotent — running it twice changes nothing.
 */
wishlistRouter.post(
  '/merge',
  csrfProtection,
  validate({ body: wishlistMergeBody }),
  async (req, res, next) => {
    try {
      const { productIds } = req.body as { productIds: string[] };
      const userId = req.session!.id;

      if (productIds.length === 0) {
        res.json(ok({ merged: 0, skipped: 0 }));
        return;
      }

      // Only merge ids that are real products — a stale localStorage id from the
      // mock era must not create a dangling row.
      const real = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      const realIds = real.map((p) => p.id);

      const result = await prisma.wishlist.createMany({
        data: realIds.map((productId) => ({ userId, productId })),
        skipDuplicates: true,
      });

      res.json(
        ok({
          merged: result.count,
          skipped: productIds.length - result.count,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
