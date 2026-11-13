/**
 * `/api/v1/admin/audit` — the audit trail (Phase 10 pass C, System).
 *
 * The endpoint started life inside `index.ts` as a "newest 50 rows" probe, built
 * to prove that mutations wrote audit rows at all. It is now a real screen, so it
 * gets a real list contract: filters, pagination and an honest total.
 *
 * ── What this screen is for ────────────────────────────────────────────────
 *
 * Answering "who changed this, and when". The filter that matters is free text
 * over action / entity / entity id, because an operator arrives with one of those
 * three in hand — an order number, a product id, or an action name they saw in a
 * report. Date range is the second filter; a full-text search over `changes` is
 * deliberately absent: the JSON payload is large, unindexed, and the row already
 * tells you which record to open.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const auditRouter: Router = Router();

const auditQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    /** Exact entity name, e.g. `product`, `order`. */
    entity: z.string().trim().max(40).optional(),
    from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

auditRouter.get('/', requirePermission('audit:read'), validate({ query: auditQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof auditQuery>;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q } },
              { entity: { contains: query.q } },
              { entityId: { contains: query.q } },
              { user: { is: { name: { contains: query.q } } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json(
      ok({
        entries: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          userName: row.user?.name ?? null,
          userRole: row.user?.role ?? null,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          changes: row.changes,
          ipAddress: row.ipAddress,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        limit: query.limit,
      }),
    );
  } catch (error) {
    next(error);
  }
});
