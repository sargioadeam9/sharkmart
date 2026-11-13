/**
 * `/api/v1/admin/customers` — Phase 10 pass G (CRM).
 *
 * ── Segments are computed, not stored ──────────────────────────────────────
 *
 *   new         joined in the last 30 days
 *   returning   two or more orders that were not cancelled or returned
 *   high_value  lifetime spend of ৳10,000 or more
 *   inactive    no order for 90 days (or never ordered and joined over 90 days ago)
 *
 * A stored segment column would be wrong the moment a customer places their second
 * order, and would need a nightly job to stay honest. These are `HAVING` clauses
 * over the same aggregate the list already computes, so the number in the badge
 * and the rows behind it cannot disagree.
 *
 * The segments overlap on purpose — a returning customer can also be high value —
 * so they are filters, not buckets.
 *
 * ── Why the list is raw SQL ────────────────────────────────────────────────
 *
 * Every row needs `COUNT(orders)`, `SUM(total)` and `MAX(createdAt)` from another
 * table. Prisma's `groupBy` cannot return the parent rows alongside those
 * aggregates, and fetching users then aggregating per user is an N+1 over 2,700
 * rows. One grouped query with a `HAVING` filter is the honest shape.
 */

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';
import { notFound } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';

export const customersRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }) {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

/** ৳10,000 — the boundary between a regular and a high-value customer. */
const HIGH_VALUE_POISHA = 1_000_000;

const listQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    segment: z.enum(['all', 'new', 'returning', 'high_value', 'inactive']).default('all'),
    sort: z.enum(['spend', 'orders', 'recent', 'joined']).default('spend'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid() }).strict();

const noteParams = z
  .object({ id: z.string().uuid(), noteId: z.string().uuid() })
  .strict();

const noteBody = z
  .object({ body: z.string().trim().min(1, 'a note cannot be empty').max(2000) })
  .strict();

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  orders: unknown;
  spend: unknown;
  lastOrderAt: Date | null;
}

function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  return Number(value);
}

/** The `HAVING` clause for a segment, as a Prisma SQL fragment. */
function segmentHaving(segment: string): Prisma.Sql {
  switch (segment) {
    case 'new':
      // `MAX(u.createdAt)` rather than `u.createdAt`: MySQL rejects a bare
      // column in HAVING unless it is grouped, and the value is identical across
      // the group anyway.
      return Prisma.sql`MAX(u.createdAt) >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)`;
    case 'returning':
      return Prisma.sql`COUNT(o.id) >= 2`;
    case 'high_value':
      return Prisma.sql`COALESCE(SUM(o.totalAmountPoisha), 0) >= ${HIGH_VALUE_POISHA}`;
    case 'inactive':
      return Prisma.sql`(
        (MAX(o.createdAt) IS NULL AND MAX(u.createdAt) < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 90 DAY))
        OR MAX(o.createdAt) < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 90 DAY)
      )`;
    default:
      return Prisma.sql`1 = 1`;
  }
}

function orderBy(sort: string): Prisma.Sql {
  switch (sort) {
    case 'orders':
      return Prisma.sql`orders DESC`;
    case 'recent':
      return Prisma.sql`lastOrderAt DESC`;
    case 'joined':
      return Prisma.sql`u.createdAt DESC`;
    default:
      return Prisma.sql`spend DESC`;
  }
}

customersRouter.get('/', requirePermission('customers:read'), validate({ query: listQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof listQuery>;
    const offset = (query.page - 1) * query.limit;

    // The `LEFT JOIN ... AND` keeps cancelled orders out of the aggregate without
    // dropping the customer — a `WHERE` on the joined table would turn this into
    // an inner join and hide anyone who has only ever cancelled.
    const search = query.q
      ? Prisma.sql`AND (u.name LIKE ${`%${query.q}%`} OR u.email LIKE ${`%${query.q}%`} OR u.phone LIKE ${`%${query.q}%`})`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<CustomerRow[]>`
      SELECT u.id, u.name, u.email, u.phone, u.isActive, u.createdAt,
             COUNT(o.id) AS orders,
             COALESCE(SUM(o.totalAmountPoisha), 0) AS spend,
             MAX(o.createdAt) AS lastOrderAt
      FROM \`User\` u
      LEFT JOIN \`Order\` o
        ON o.userId = u.id AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
      WHERE u.role = 'CUSTOMER' ${search}
      GROUP BY u.id
      HAVING ${segmentHaving(query.segment)}
      ORDER BY ${orderBy(query.sort)}
      LIMIT ${query.limit} OFFSET ${offset}
    `;

    const counted = await prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT COUNT(*) AS total FROM (
        SELECT u.id
        FROM \`User\` u
        LEFT JOIN \`Order\` o
          ON o.userId = u.id AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
        WHERE u.role = 'CUSTOMER' ${search}
        GROUP BY u.id
        HAVING ${segmentHaving(query.segment)}
      ) t
    `;

    res.json(
      ok({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          isActive: row.isActive,
          createdAt: row.createdAt.toISOString(),
          orders: num(row.orders),
          spendPoisha: num(row.spend),
          lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
        })),
        total: num(counted[0]?.total),
        page: query.page,
        limit: query.limit,
      }),
    );
  } catch (error) {
    next(error);
  }
});

customersRouter.get('/:id', requirePermission('customers:read'), validate({ params: idParams }), async (req, res, next) => {
  try {
    const id = req.params.id!;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        emailVerified: true,
        phoneVerified: true,
        language: true,
        createdAt: true,
        addresses: {
          select: {
            id: true,
            recipientName: true,
            phone: true,
            division: true,
            district: true,
            area: true,
            address: true,
            isDefault: true,
          },
        },
        _count: { select: { orders: true, wishlist: true, reviews: true, notes: true } },
      },
    });
    if (!user) throw notFound('Customer');

    const [agg, recentOrders, notes, notifications] = await Promise.all([
      prisma.order.aggregate({
        where: { userId: id, currentStatus: { notIn: ['CANCELLED', 'RETURNED'] } },
        _count: { _all: true },
        _sum: { totalAmountPoisha: true },
        _max: { createdAt: true },
      }),
      prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          currentStatus: true,
          paymentStatus: true,
          totalAmountPoisha: true,
          createdAt: true,
        },
      }),
      prisma.customerNote.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, body: true, createdBy: true, createdAt: true },
      }),
      // "Comms history": what the shop has sent this customer, and whether it
      // left. Notification is the only record of that today — there is no SMS or
      // email sender yet, so these rows are what a future sender will fill.
      prisma.notification.findMany({
        where: { recipientId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          type: true,
          channel: true,
          subject: true,
          status: true,
          createdAt: true,
          sentAt: true,
        },
      }),
    ]);

    const authorIds = [...new Set(notes.map((note) => note.createdBy))];
    const authors =
      authorIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, name: true },
          });
    const authorById = new Map(authors.map((author) => [author.id, author.name]));

    const orders = agg._count._all;
    const spend = agg._sum.totalAmountPoisha ?? 0;

    res.json(
      ok({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        language: user.language,
        createdAt: user.createdAt.toISOString(),
        stats: {
          orders,
          spendPoisha: spend,
          averageOrderPoisha: orders === 0 ? 0 : Math.round(spend / orders),
          lastOrderAt: agg._max.createdAt?.toISOString() ?? null,
          wishlistCount: user._count.wishlist,
          reviewCount: user._count.reviews,
          noteCount: user._count.notes,
        },
        addresses: user.addresses,
        orders: recentOrders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.currentStatus,
          paymentStatus: order.paymentStatus,
          totalAmountPoisha: order.totalAmountPoisha,
          createdAt: order.createdAt.toISOString(),
        })),
        notes: notes.map((note) => ({
          id: note.id,
          body: note.body,
          createdBy: note.createdBy,
          createdByName: authorById.get(note.createdBy) ?? null,
          createdAt: note.createdAt.toISOString(),
        })),
        notifications: notifications.map((row) => ({
          id: row.id,
          type: row.type,
          channel: row.channel,
          subject: row.subject,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null,
        })),
      }),
    );
  } catch (error) {
    next(error);
  }
});

customersRouter.post(
  '/:id/notes',
  requirePermission('customers:write'),
  validate({ params: idParams, body: noteBody }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as { body: string };

      const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound('Customer');

      const actor = actorFrom(req);

      const note = await withAudit(
        () => ({
          userId: actor.userId,
          action: 'customer.note.create',
          entity: 'customer',
          entityId: id,
          changes: { note: body.body },
          ipAddress: actor.ipAddress,
        }),
        async (tx) =>
          tx.customerNote.create({
            data: { userId: id, body: body.body, createdBy: actor.userId },
            select: { id: true, body: true, createdBy: true, createdAt: true },
          }),
      );

      res.status(201).json(
        ok({
          id: note.id,
          body: note.body,
          createdBy: note.createdBy,
          createdAt: note.createdAt.toISOString(),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.delete(
  '/:id/notes/:noteId',
  requirePermission('customers:write'),
  validate({ params: noteParams }),
  async (req, res, next) => {
    try {
      const { id, noteId } = req.params as { id: string; noteId: string };

      const note = await prisma.customerNote.findFirst({
        where: { id: noteId, userId: id },
        select: { id: true, body: true },
      });
      if (!note) throw notFound('Note');

      const actor = actorFrom(req);

      await withAudit(
        {
          userId: actor.userId,
          action: 'customer.note.delete',
          entity: 'customer',
          entityId: id,
          changes: { removed: note.body },
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.customerNote.delete({ where: { id: noteId } });
        },
      );

      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  },
);
