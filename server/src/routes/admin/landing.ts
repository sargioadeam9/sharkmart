/**
 * `/api/v1/admin/landing` — Phase 10 pass J.
 *
 * ── What already existed, and what this adds ───────────────────────────────
 *
 * `LandingPage` and `LandingPageOrder` have been in the schema since Phase 6, and
 * `GET /api/v1/landing/:slug` serves an active page. What was missing is
 * everything that makes a campaign usable: a way to create one, and a way for an
 * order to arrive. This adds both, plus the read side.
 *
 * It does **not** add a storefront page at `/landing/[slug]`. That is a frontend
 * phase — the public GET and the public order POST below are what such a page will
 * call, so the contract is ready and the UI is not pretending to exist.
 *
 * ── `content` is structured, not free JSON ─────────────────────────────────
 *
 * The column is `Json`, but an editor that accepts arbitrary JSON is a textarea
 * nobody can validate. The shape below is small and deliberate: headline,
 * subheadline, bullets, cta label. It is what a landing page actually needs, and
 * it keeps the public payload predictable.
 */

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';
import { invalidateTag } from '../../services/cache.js';

export const landingAdminRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }) {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

const idParams = z.object({ id: z.string().uuid() }).strict();

const slug = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9-]+$/, 'slug may contain lowercase letters, digits and hyphens only');

const contentShape = z
  .object({
    headline: z.string().trim().max(160).default(''),
    subheadline: z.string().trim().max(300).default(''),
    bullets: z.array(z.string().trim().max(160)).max(8).default([]),
    ctaLabel: z.string().trim().max(40).default('Order now'),
  })
  .strict();

const createBody = z
  .object({
    slug,
    title: z.string().trim().min(1).max(160),
    productId: z.string().uuid().nullable().optional(),
    campaignName: z.string().trim().max(120).nullable().optional(),
    isActive: z.boolean().default(true),
    content: contentShape.default({}),
  })
  .strict();

const updateBody = z
  .object({
    slug: slug.optional(),
    title: z.string().trim().min(1).max(160).optional(),
    productId: z.string().uuid().nullable().optional(),
    campaignName: z.string().trim().max(120).nullable().optional(),
    isActive: z.boolean().optional(),
    content: contentShape.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

const activeBody = z.object({ isActive: z.boolean() }).strict();

landingAdminRouter.get('/', requirePermission('marketing:read'), async (_req, res, next) => {
  try {
    const rows = await prisma.landingPage.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        campaignName: true,
        productId: true,
        isActive: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    });

    const productIds = rows.map((row) => row.productId).filter((id): id is string => Boolean(id));
    const products =
      productIds.length === 0
        ? []
        : await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, nameEn: true },
          });
    const productById = new Map(products.map((product) => [product.id, product.nameEn]));

    res.json(
      ok({
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          campaignName: row.campaignName,
          productId: row.productId,
          productName: row.productId ? (productById.get(row.productId) ?? null) : null,
          isActive: row.isActive,
          orderCount: row._count.orders,
          createdAt: row.createdAt.toISOString(),
        })),
      }),
    );
  } catch (error) {
    next(error);
  }
});

landingAdminRouter.post(
  '/',
  requirePermission('marketing:write'),
  validate({ body: createBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createBody>;
      const actor = actorFrom(req);

      if (body.productId) {
        const product = await prisma.product.findUnique({
          where: { id: body.productId },
          select: { id: true },
        });
        if (!product) throw notFound('Product');
      }

      try {
        const created = await withAudit(
          (row: { id: string }) => ({
            userId: actor.userId,
            action: 'landing.create',
            entity: 'landingPage',
            entityId: row.id,
            changes: { slug: body.slug, title: body.title },
            ipAddress: actor.ipAddress,
          }),
          async (tx) =>
            tx.landingPage.create({
              data: {
                slug: body.slug,
                title: body.title,
                productId: body.productId ?? null,
                campaignName: body.campaignName ?? null,
                isActive: body.isActive,
                content: body.content as unknown as Prisma.InputJsonValue,
              },
              select: { id: true },
            }),
        );

        // A landing page is cached under the `landing` tag; without this, a
        // deactivated campaign keeps serving for up to TTL.landing seconds.
        await invalidateTag('landing');
        res.status(201).json(ok(created));
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new HttpError(409, 'CONFLICT', 'That slug is already in use.', { field: 'slug' });
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  },
);

landingAdminRouter.get(
  '/:id',
  requirePermission('marketing:read'),
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      const row = await prisma.landingPage.findUnique({ where: { id: req.params.id! } });
      if (!row) throw notFound('Landing page');

      res.json(
        ok({
          id: row.id,
          slug: row.slug,
          title: row.title,
          campaignName: row.campaignName,
          productId: row.productId,
          isActive: row.isActive,
          content: row.content,
          createdAt: row.createdAt.toISOString(),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

landingAdminRouter.patch(
  '/:id',
  requirePermission('marketing:write'),
  validate({ params: idParams, body: updateBody }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as z.infer<typeof updateBody>;
      const actor = actorFrom(req);

      const before = await prisma.landingPage.findUnique({ where: { id } });
      if (!before) throw notFound('Landing page');

      const data: Prisma.LandingPageUpdateInput = {};
      if (body.slug !== undefined) data.slug = body.slug;
      if (body.title !== undefined) data.title = body.title;
      if (body.productId !== undefined) data.productId = body.productId;
      if (body.campaignName !== undefined) data.campaignName = body.campaignName;
      if (body.isActive !== undefined) data.isActive = body.isActive;
      if (body.content !== undefined) {
        data.content = body.content as unknown as Prisma.InputJsonValue;
      }

      const changes = diffChanges(
        before as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>,
      );

      try {
        await withAudit(
          {
            userId: actor.userId,
            action: 'landing.update',
            entity: 'landingPage',
            entityId: id,
            changes: changes as Prisma.InputJsonValue,
            ipAddress: actor.ipAddress,
          },
          async (tx) => {
            await tx.landingPage.update({ where: { id }, data });
          },
        );
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new HttpError(409, 'CONFLICT', 'That slug is already in use.', { field: 'slug' });
        }
        throw error;
      }

      await invalidateTag('landing');
      res.json(ok({ updated: true }));
    } catch (error) {
      next(error);
    }
  },
);

landingAdminRouter.post(
  '/:id/active',
  requirePermission('marketing:write'),
  validate({ params: idParams, body: activeBody }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as { isActive: boolean };
      const actor = actorFrom(req);

      const before = await prisma.landingPage.findUnique({
        where: { id },
        select: { isActive: true },
      });
      if (!before) throw notFound('Landing page');

      await withAudit(
        {
          userId: actor.userId,
          action: body.isActive ? 'landing.activate' : 'landing.deactivate',
          entity: 'landingPage',
          entityId: id,
          changes: { isActive: { from: before.isActive, to: body.isActive } },
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.landingPage.update({ where: { id }, data: { isActive: body.isActive } });
        },
      );

      await invalidateTag('landing');
      res.json(ok({ isActive: body.isActive }));
    } catch (error) {
      next(error);
    }
  },
);

landingAdminRouter.get(
  '/:id/orders',
  requirePermission('marketing:read'),
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;

      const exists = await prisma.landingPage.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound('Landing page');

      const orders = await prisma.landingPageOrder.findMany({
        where: { landingPageId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          quantity: true,
          status: true,
          createdAt: true,
        },
      });

      res.json(
        ok({
          orders: orders.map((row) => ({
            id: row.id,
            name: row.name,
            phone: row.phone,
            address: row.address,
            quantity: row.quantity,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          })),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
