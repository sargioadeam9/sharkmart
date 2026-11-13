/**
 * `/api/v1/admin/staff` — Phase 10 pass I (roles and security).
 *
 * `staff:manage` is held by SUPER_ADMIN alone, and that is deliberate: this is the
 * one screen that can hand out or remove power. Everything here is audited.
 *
 * ── The four guards, and why each exists ───────────────────────────────────
 *
 *   1. You cannot change your own role. The most common way to lose access to an
 *      admin panel is to demote yourself by accident, and the second most common
 *      is to do it while nobody else can promote you back.
 *   2. You cannot deactivate yourself, for the same reason.
 *   3. The last active SUPER_ADMIN cannot be demoted or deactivated. A shop with
 *      no super admin cannot appoint one.
 *   4. Revoking a user's sessions is its own action, not a side effect of a role
 *      change — a demoted manager may legitimately still need to finish a task,
 *      and silently logging them out mid-shift is not a security improvement.
 *
 * Passwords are never returned, never generated here, and never reset here. A
 * reset flow needs email delivery, which this project does not have yet; inventing
 * a "show the new password once" screen without a way to deliver it would be worse
 * than leaving it out.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';
import { permissionsFor } from '../../services/permissions.js';

export const staffRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }) {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

const idParams = z.object({ id: z.string().uuid() }).strict();

const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_STAFF', 'MARKETING_STAFF'] as const;

const roleBody = z.object({ role: z.enum(STAFF_ROLES) }).strict();
const activeBody = z.object({ isActive: z.boolean() }).strict();

interface StaffRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: Date;
  sessions: number;
  permissions: string[];
}

staffRouter.get('/', requirePermission('staff:manage'), async (_req, res, next) => {
  try {
    const rows = await prisma.user.findMany({
      where: { role: { not: 'CUSTOMER' } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            refreshTokens: { where: { revokedAt: null, expiresAt: { gt: new Date() } } },
          },
        },
      },
    });

    const items: StaffRow[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      isActive: row.isActive,
      createdAt: row.createdAt,
      sessions: row._count.refreshTokens,
      permissions: permissionsFor(row.role),
    }));

    res.json(
      ok({
        items: items.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        roles: STAFF_ROLES,
      }),
    );
  } catch (error) {
    next(error);
  }
});

/** Counts the *other* active super admins — the guard behind guard 3. */
async function otherActiveSupers(excludeId: string): Promise<number> {
  return prisma.user.count({
    where: { role: 'SUPER_ADMIN', isActive: true, id: { not: excludeId } },
  });
}

staffRouter.patch(
  '/:id/role',
  requirePermission('staff:manage'),
  validate({ params: idParams, body: roleBody }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as { role: (typeof STAFF_ROLES)[number] };
      const actor = actorFrom(req);

      const target = await prisma.user.findUnique({
        where: { id },
        select: { id: true, role: true, name: true, isActive: true },
      });
      if (!target) throw notFound('Staff member');

      if (target.id === actor.userId) {
        throw new HttpError(409, 'CONFLICT', 'You cannot change your own role.', {
          reason: 'SELF_ROLE_CHANGE',
        });
      }

      if (target.role === body.role) {
        res.json(ok({ updated: false, reason: 'already that role' }));
        return;
      }

      if (target.role === 'SUPER_ADMIN' && target.isActive) {
        const others = await otherActiveSupers(id);
        if (others === 0) {
          throw new HttpError(
            409,
            'CONFLICT',
            'This is the last active super admin. Promote someone else first.',
            { reason: 'LAST_SUPER_ADMIN' },
          );
        }
      }

      await withAudit(
        {
          userId: actor.userId,
          action: 'staff.role.update',
          entity: 'user',
          entityId: id,
          changes: { role: { from: target.role, to: body.role } },
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.user.update({ where: { id }, data: { role: body.role } });
        },
      );

      res.json(ok({ updated: true, role: body.role }));
    } catch (error) {
      next(error);
    }
  },
);

staffRouter.post(
  '/:id/active',
  requirePermission('staff:manage'),
  validate({ params: idParams, body: activeBody }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as { isActive: boolean };
      const actor = actorFrom(req);

      const target = await prisma.user.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, name: true },
      });
      if (!target) throw notFound('Staff member');

      if (target.id === actor.userId && !body.isActive) {
        throw new HttpError(409, 'CONFLICT', 'You cannot deactivate your own account.', {
          reason: 'SELF_DEACTIVATE',
        });
      }

      if (target.isActive === body.isActive) {
        res.json(ok({ updated: false }));
        return;
      }

      if (!body.isActive && target.role === 'SUPER_ADMIN') {
        const others = await otherActiveSupers(id);
        if (others === 0) {
          throw new HttpError(
            409,
            'CONFLICT',
            'This is the last active super admin. Promote someone else first.',
            { reason: 'LAST_SUPER_ADMIN' },
          );
        }
      }

      await withAudit(
        {
          userId: actor.userId,
          action: body.isActive ? 'staff.activate' : 'staff.deactivate',
          entity: 'user',
          entityId: id,
          changes: { isActive: { from: target.isActive, to: body.isActive } },
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.user.update({ where: { id }, data: { isActive: body.isActive } });
        },
      );

      res.json(ok({ updated: true, isActive: body.isActive }));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Revokes every live refresh token for one user.
 *
 * The access token stays valid until it expires (15 minutes) — that is the honest
 * limit of a stateless access token, and it is worth knowing rather than
 * pretending this is an instant lockout.
 */
staffRouter.post(
  '/:id/revoke-sessions',
  requirePermission('staff:manage'),
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const actor = actorFrom(req);

      const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!target) throw notFound('Staff member');

      const result = await withAudit(
        {
          userId: actor.userId,
          action: 'staff.sessions.revoke',
          entity: 'user',
          entityId: id,
          changes: { note: 'all live refresh tokens revoked' },
          ipAddress: actor.ipAddress,
        },
        async (tx) =>
          tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
      );

      res.json(
        ok({
          revoked: result.count,
          note: 'Access tokens remain valid until they expire (up to 15 minutes).',
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
