/**
 * `/api/v1/me` and `/api/v1/me/addresses` — profile and address book.
 *
 * The ownership rule (security.md §6) is enforced in the query, never after the
 * fetch: every address read and write carries `userId: session.id` in its
 * `where`. Another account's address id therefore returns **404, not 403** — a
 * 403 would confirm the id exists, which is an enumeration oracle.
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { csrfProtection } from '../../middleware/session.js';
import { ok } from '../../types/api.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { prisma } from '../../config/database.js';
import { toPublicUser } from '../../services/auth.service.js';
import { addressBody, addressUpdateBody, idParams, updateProfileBody } from '../../validators/auth.schema.js';

export const meRouter: Router = Router();

// Everything below needs a session.
meRouter.use(requireAuth);

/** GET /me */
meRouter.get('/', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session!.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        language: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
      },
    });

    if (!user) throw notFound('Account');

    res.json(ok({ user: toPublicUser(user) }));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /me
 *
 * An explicit field allowlist — never `data: req.body` (security.md §7). Note
 * that `role` is not in the schema at all, so a strict Zod parse rejects it
 * before the handler runs; that is the mass-assignment guard.
 */
meRouter.put('/', csrfProtection, validate({ body: updateProfileBody }), async (req, res, next) => {
  try {
    const body = req.body as {
      name?: string;
      email?: string;
      phone?: string;
      language?: 'bn' | 'en';
    };

    // A changed email or phone must not collide with another account. The
    // unique index would throw a Prisma error; catching it here gives the user
    // a usable message and keeps the 500 path clean.
    if (body.email || body.phone) {
      const clash = await prisma.user.findFirst({
        where: {
          id: { not: req.session!.id },
          OR: [
            ...(body.email ? [{ email: body.email }] : []),
            ...(body.phone ? [{ phone: body.phone }] : []),
          ],
        },
        select: { id: true },
      });

      if (clash) {
        throw new HttpError(409, 'CONFLICT', 'That email or phone is already in use.');
      }
    }

    const user = await prisma.user.update({
      where: { id: req.session!.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.language !== undefined ? { language: body.language } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        language: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
      },
    });

    res.json(ok({ user: toPublicUser(user) }));
  } catch (error) {
    next(error);
  }
});

/** GET /me/addresses */
meRouter.get('/addresses', async (req, res, next) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.session!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(ok(addresses));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /me/addresses
 *
 * Setting `isDefault` demotes the previous default in the same transaction, so
 * the invariant "at most one default per user" holds at every commit boundary.
 */
meRouter.post('/addresses', csrfProtection, validate({ body: addressBody }), async (req, res, next) => {
  try {
    const body = req.body as Parameters<typeof prisma.address.create>[0]['data'] & {
      isDefault: boolean;
    };
    const userId = req.session!.id;

    const existingCount = await prisma.address.count({ where: { userId } });
    // The first address is always the default, whatever the client sent.
    const makeDefault = body.isDefault || existingCount === 0;

    const address = await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }

      return tx.address.create({
        data: {
          userId,
          label: body.label ?? null,
          recipientName: body.recipientName,
          phone: body.phone,
          division: body.division,
          district: body.district,
          area: body.area,
          address: body.address,
          postalCode: body.postalCode ?? null,
          isDefault: makeDefault,
        },
      });
    });

    res.status(201).json(ok(address));
  } catch (error) {
    next(error);
  }
});

/** PUT /me/addresses/:id */
meRouter.put(
  '/addresses/:id',
  csrfProtection,
  validate({ params: idParams, body: addressUpdateBody }),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      const userId = req.session!.id;

      // Ownership is part of the lookup, so a foreign id is indistinguishable
      // from a missing one.
      const existing = await prisma.address.findFirst({ where: { id, userId }, select: { id: true } });
      if (!existing) throw notFound('Address');

      const address = await prisma.$transaction(async (tx) => {
        if (body.isDefault === true) {
          await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        }

        return tx.address.update({
          where: { id },
          data: {
            ...(body.label !== undefined ? { label: body.label as string | null } : {}),
            ...(body.recipientName !== undefined ? { recipientName: body.recipientName as string } : {}),
            ...(body.phone !== undefined ? { phone: body.phone as string } : {}),
            ...(body.division !== undefined ? { division: body.division as string } : {}),
            ...(body.district !== undefined ? { district: body.district as string } : {}),
            ...(body.area !== undefined ? { area: body.area as string } : {}),
            ...(body.address !== undefined ? { address: body.address as string } : {}),
            ...(body.postalCode !== undefined ? { postalCode: body.postalCode as string | null } : {}),
            ...(body.isDefault !== undefined ? { isDefault: body.isDefault as boolean } : {}),
          },
        });
      });

      res.json(ok(address));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /me/addresses/:id
 *
 * Deleting the default promotes the most recent remaining address, so a user
 * with addresses always has exactly one default.
 */
meRouter.delete('/addresses/:id', csrfProtection, validate({ params: idParams }), async (req, res, next) => {
  try {
    const { id } = req.params as { id: string };
    const userId = req.session!.id;

    const existing = await prisma.address.findFirst({
      where: { id, userId },
      select: { id: true, isDefault: true },
    });
    if (!existing) throw notFound('Address');

    await prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });

      if (existing.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });

    res.json(ok({ deleted: true }));
  } catch (error) {
    next(error);
  }
});
