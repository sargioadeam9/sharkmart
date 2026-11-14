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
import { hashPassword } from '../../services/password.service.js';

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

// ─── Create ────────────────────────────────────────────────────────────────

const createStaffBody = z
  .object({
    name: z.string().trim().min(2, 'a name is required').max(120),
    email: z.string().trim().toLowerCase().email('enter a valid email').max(254),
    phone: z
      .string()
      .trim()
      .regex(/^(?:\+?880|0)1[3-9]\d{8}$/, 'enter a valid Bangladesh mobile number')
      .optional(),
    role: z.enum(STAFF_ROLES),
    /**
     * Chosen by the person creating the account, and shown to them once.
     *
     * There is no invite email: the mail transport exists but a staff invite is
     * a different flow (token, expiry, first-login password change) and half of
     * it would be worse than none. The creator reads the password out and the
     * new staff member changes it from their profile.
     */
    password: z.string().min(8, 'at least 8 characters').max(128),
  })
  .strict();

staffRouter.post(
  '/',
  requirePermission('staff:manage'),
  validate({ body: createStaffBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createStaffBody>;
      const actor = actorFrom(req);

      const existing = await prisma.user.findFirst({
        where: { email: body.email },
        select: { id: true },
      });

      if (existing) {
        throw new HttpError(409, 'CONFLICT', 'An account with that email already exists.');
      }

      const passwordHash = await hashPassword(body.password);

      const created = await withAudit<{ id: string; name: string; email: string | null; role: string }>(
        (result) => ({
          userId: actor.userId,
          action: 'staff.create',
          entity: 'user',
          entityId: result.id,
          changes: { name: body.name, email: body.email, role: body.role },
          ipAddress: actor.ipAddress,
        }),
        async (tx) =>
          tx.user.create({
            data: {
              name: body.name,
              email: body.email,
              phone: body.phone ?? null,
              passwordHash,
              role: body.role,
              isActive: true,
            },
            select: { id: true, name: true, email: true, role: true },
          }),
      );

      res.status(201).json(
        ok({
          user: { ...created, permissions: permissionsFor(created.role) },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── Delete ────────────────────────────────────────────────────────────────

/**
 * Removes a staff account.
 *
 * Three refusals, each for a different reason:
 *
 *   yourself          deleting the session you are using is a foot-gun, and the
 *                     account that can do it is the one that should not.
 *   the last super    the shop would have nobody who can manage staff.
 *   anyone with orders  `Order.userId` is a RESTRICT foreign key — the delete
 *                     would fail at the database with a Prisma error instead of
 *                     a sentence. A staff member who also bought something is
 *                     deactivated, not deleted, and the message says so.
 *
 * Deletion is real, not soft: the row goes, and with it the refresh tokens and
 * notifications (both cascade). The audit row is written first and outlives the
 * user, because `AuditLog.userId` is a plain column with no foreign key.
 */
staffRouter.delete(
  '/:id',
  requirePermission('staff:manage'),
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const actor = actorFrom(req);

      const target = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, role: true, isActive: true },
      });

      if (!target) throw notFound('Staff member');

      if (target.id === actor.userId) {
        throw new HttpError(409, 'CONFLICT', 'You cannot delete your own account.', {
          reason: 'SELF_DELETE',
        });
      }

      if (target.role === 'SUPER_ADMIN' && target.isActive) {
        const others = await otherActiveSupers(id);
        if (others === 0) {
          throw new HttpError(409, 'CONFLICT', 'This is the last active super admin.', {
            reason: 'LAST_SUPER_ADMIN',
          });
        }
      }

      const orderCount = await prisma.order.count({ where: { userId: id } });
      if (orderCount > 0) {
        throw new HttpError(
          409,
          'CONFLICT',
          `${target.name} has ${orderCount} order${orderCount === 1 ? '' : 's'} in their name. Deactivate the account instead — deleting it would orphan the order history.`,
          { reason: 'HAS_ORDERS' },
        );
      }

      await withAudit(
        {
          userId: actor.userId,
          action: 'staff.delete',
          entity: 'user',
          entityId: id,
          changes: { name: target.name, role: target.role },
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.user.delete({ where: { id } });
        },
      );

      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  },
);
