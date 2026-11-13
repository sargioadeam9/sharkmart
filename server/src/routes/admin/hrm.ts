/**
 * `/api/v1/admin/hrm` — Phase 10 pass K.
 *
 * Employees, attendance and leave. Gated on `staff:manage`, which belongs to
 * SUPER_ADMIN alone: `Employee.salaryPoisha` is on every row, and payroll is not
 * something an order manager should be able to read.
 *
 * ── `Employee.userId` is a plain string, not a foreign key ─────────────────
 *
 * The schema stores the id without a relation, so nothing stops an employee row
 * pointing at a user that does not exist. Every read joins manually and every
 * write checks the user first; a row whose user vanished renders as "(missing
 * user)" rather than crashing the list.
 *
 * ── Attendance is one row per employee per day ────────────────────────────
 *
 * `@@unique([employeeId, date])` is the rule, so marking the same day twice is an
 * upsert, not a duplicate. The date is stored at UTC midnight for the same reason
 * expenses are: a day is a day in every timezone the report is opened in.
 */

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';

export const hrmRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }) {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

const idParams = z.object({ id: z.string().uuid() }).strict();
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

const employeeCreateBody = z
  .object({
    userId: z.string().uuid(),
    department: z.string().trim().max(80).nullable().optional(),
    designation: z.string().trim().max(80).nullable().optional(),
    joiningDate: day.nullable().optional(),
    salaryPoisha: z.number().int().min(0).nullable().optional(),
  })
  .strict();

const employeeUpdateBody = z
  .object({
    department: z.string().trim().max(80).nullable().optional(),
    designation: z.string().trim().max(80).nullable().optional(),
    joiningDate: day.nullable().optional(),
    salaryPoisha: z.number().int().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

const attendanceBody = z
  .object({
    employeeId: z.string().uuid(),
    date: day,
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY']).default('PRESENT'),
  })
  .strict();

const attendanceQuery = z.object({ date: day }).strict();

const leaveCreateBody = z
  .object({
    employeeId: z.string().uuid(),
    type: z.enum(['CASUAL', 'SICK', 'ANNUAL', 'UNPAID']),
    startDate: day,
    endDate: day,
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => new Date(value.endDate) >= new Date(value.startDate), {
    message: 'endDate must not be before startDate',
    path: ['endDate'],
  });

const leaveQuery = z
  .object({ status: z.enum(['all', 'PENDING', 'APPROVED', 'REJECTED']).default('all') })
  .strict();

const decideBody = z.object({ approve: z.boolean() }).strict();

const dayStart = (value: string) => new Date(`${value}T00:00:00.000Z`);

// ─── Employees ─────────────────────────────────────────────────────────────

hrmRouter.get('/employees', requirePermission('staff:manage'), async (_req, res, next) => {
  try {
    const rows = await prisma.employee.findMany({
      orderBy: [{ isActive: 'desc' }, { joiningDate: 'desc' }],
      select: {
        id: true,
        userId: true,
        department: true,
        designation: true,
        joiningDate: true,
        salaryPoisha: true,
        isActive: true,
      },
    });

    const userIds = rows.map((row) => row.userId);
    const users =
      userIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true, phone: true, role: true },
          });
    const userById = new Map(users.map((user) => [user.id, user]));

    res.json(
      ok({
        items: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          name: userById.get(row.userId)?.name ?? '(missing user)',
          email: userById.get(row.userId)?.email ?? null,
          phone: userById.get(row.userId)?.phone ?? null,
          role: userById.get(row.userId)?.role ?? null,
          department: row.department,
          designation: row.designation,
          joiningDate: row.joiningDate?.toISOString().slice(0, 10) ?? null,
          salaryPoisha: row.salaryPoisha,
          isActive: row.isActive,
        })),
      }),
    );
  } catch (error) {
    next(error);
  }
});

hrmRouter.post(
  '/employees',
  requirePermission('staff:manage'),
  validate({ body: employeeCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof employeeCreateBody>;
      const actor = actorFrom(req);

      const user = await prisma.user.findUnique({
        where: { id: body.userId },
        select: { id: true, name: true },
      });
      if (!user) throw notFound('User');

      const existing = await prisma.employee.findUnique({
        where: { userId: body.userId },
        select: { id: true },
      });
      if (existing) {
        throw new HttpError(409, 'CONFLICT', 'That user is already an employee.', {
          field: 'userId',
        });
      }

      const created = await withAudit(
        (row: { id: string }) => ({
          userId: actor.userId,
          action: 'employee.create',
          entity: 'employee',
          entityId: row.id,
          changes: { user: user.name, department: body.department ?? null },
          ipAddress: actor.ipAddress,
        }),
        async (tx) =>
          tx.employee.create({
            data: {
              userId: body.userId,
              department: body.department ?? null,
              designation: body.designation ?? null,
              joiningDate: body.joiningDate ? dayStart(body.joiningDate) : null,
              salaryPoisha: body.salaryPoisha ?? null,
            },
            select: { id: true },
          }),
      );

      res.status(201).json(ok(created));
    } catch (error) {
      next(error);
    }
  },
);

hrmRouter.patch(
  '/employees/:id',
  requirePermission('staff:manage'),
  validate({ params: idParams, body: employeeUpdateBody }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as z.infer<typeof employeeUpdateBody>;
      const actor = actorFrom(req);

      const before = await prisma.employee.findUnique({ where: { id } });
      if (!before) throw notFound('Employee');

      const data: Prisma.EmployeeUpdateInput = {};
      if (body.department !== undefined) data.department = body.department;
      if (body.designation !== undefined) data.designation = body.designation;
      if (body.joiningDate !== undefined) {
        data.joiningDate = body.joiningDate ? dayStart(body.joiningDate) : null;
      }
      if (body.salaryPoisha !== undefined) data.salaryPoisha = body.salaryPoisha;
      if (body.isActive !== undefined) data.isActive = body.isActive;

      const changes = diffChanges(
        before as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>,
      );

      await withAudit(
        {
          userId: actor.userId,
          action: 'employee.update',
          entity: 'employee',
          entityId: id,
          changes: changes as Prisma.InputJsonValue,
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.employee.update({ where: { id }, data });
        },
      );

      res.json(ok({ updated: true }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Attendance ────────────────────────────────────────────────────────────

hrmRouter.get(
  '/attendance',
  requirePermission('staff:manage'),
  validate({ query: attendanceQuery }),
  async (req, res, next) => {
    try {
      const { date } = req.query as unknown as { date: string };
      const start = dayStart(date);

      const employees = await prisma.employee.findMany({
        where: { isActive: true },
        select: { id: true, userId: true, department: true },
      });

      const marks = await prisma.attendance.findMany({
        where: { date: start },
        select: { employeeId: true, status: true, checkIn: true, checkOut: true },
      });
      const markByEmployee = new Map(marks.map((mark) => [mark.employeeId, mark]));

      const userIds = employees.map((row) => row.userId);
      const users =
        userIds.length === 0
          ? []
          : await prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true },
            });
      const nameById = new Map(users.map((user) => [user.id, user.name]));

      res.json(
        ok({
          date,
          items: employees.map((employee) => {
            const mark = markByEmployee.get(employee.id);
            return {
              employeeId: employee.id,
              name: nameById.get(employee.userId) ?? '(missing user)',
              department: employee.department,
              status: mark?.status ?? null,
              checkIn: mark?.checkIn?.toISOString() ?? null,
              checkOut: mark?.checkOut?.toISOString() ?? null,
            };
          }),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

hrmRouter.post(
  '/attendance',
  requirePermission('staff:manage'),
  validate({ body: attendanceBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof attendanceBody>;
      const actor = actorFrom(req);
      const start = dayStart(body.date);

      const employee = await prisma.employee.findUnique({
        where: { id: body.employeeId },
        select: { id: true },
      });
      if (!employee) throw notFound('Employee');

      // One row per employee per day: marking again corrects the day.
      const saved = await withAudit(
        {
          userId: actor.userId,
          action: 'attendance.mark',
          entity: 'employee',
          entityId: body.employeeId,
          changes: { date: body.date, status: body.status },
          ipAddress: actor.ipAddress,
        },
        async (tx) =>
          tx.attendance.upsert({
            where: { employeeId_date: { employeeId: body.employeeId, date: start } },
            create: { employeeId: body.employeeId, date: start, status: body.status },
            update: { status: body.status },
            select: { id: true, status: true },
          }),
      );

      res.json(ok(saved));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Leave ─────────────────────────────────────────────────────────────────

hrmRouter.get('/leaves', requirePermission('staff:manage'), validate({ query: leaveQuery }), async (req, res, next) => {
  try {
    const { status } = req.query as unknown as { status: string };

    const rows = await prisma.leaveRequest.findMany({
      where: status === 'all' ? {} : { status },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 100,
      select: {
        id: true,
        employeeId: true,
        type: true,
        startDate: true,
        endDate: true,
        reason: true,
        status: true,
        approvedBy: true,
      },
    });

    const employees = await prisma.employee.findMany({
      where: { id: { in: rows.map((row) => row.employeeId) } },
      select: { id: true, userId: true },
    });
    const users = await prisma.user.findMany({
      where: { id: { in: employees.map((row) => row.userId) } },
      select: { id: true, name: true },
    });
    const nameByUser = new Map(users.map((user) => [user.id, user.name]));
    const userByEmployee = new Map(employees.map((row) => [row.id, row.userId]));

    res.json(
      ok({
        items: rows.map((row) => ({
          id: row.id,
          employeeId: row.employeeId,
          name: nameByUser.get(userByEmployee.get(row.employeeId) ?? '') ?? '(missing user)',
          type: row.type,
          startDate: row.startDate.toISOString().slice(0, 10),
          endDate: row.endDate.toISOString().slice(0, 10),
          reason: row.reason,
          status: row.status,
        })),
      }),
    );
  } catch (error) {
    next(error);
  }
});

hrmRouter.post(
  '/leaves',
  requirePermission('staff:manage'),
  validate({ body: leaveCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof leaveCreateBody>;
      const actor = actorFrom(req);

      const employee = await prisma.employee.findUnique({
        where: { id: body.employeeId },
        select: { id: true },
      });
      if (!employee) throw notFound('Employee');

      const created = await withAudit(
        (row: { id: string }) => ({
          userId: actor.userId,
          action: 'leave.create',
          entity: 'leaveRequest',
          entityId: row.id,
          changes: { type: body.type, from: body.startDate, to: body.endDate },
          ipAddress: actor.ipAddress,
        }),
        async (tx) =>
          tx.leaveRequest.create({
            data: {
              employeeId: body.employeeId,
              type: body.type,
              startDate: dayStart(body.startDate),
              endDate: dayStart(body.endDate),
              reason: body.reason ?? null,
              status: 'PENDING',
            },
            select: { id: true },
          }),
      );

      res.status(201).json(ok(created));
    } catch (error) {
      next(error);
    }
  },
);

hrmRouter.post(
  '/leaves/:id/decide',
  requirePermission('staff:manage'),
  validate({ params: idParams, body: decideBody }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as { approve: boolean };
      const actor = actorFrom(req);

      const before = await prisma.leaveRequest.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!before) throw notFound('Leave request');

      if (before.status !== 'PENDING') {
        throw new HttpError(409, 'CONFLICT', `This request is already ${before.status}.`);
      }

      const next = body.approve ? 'APPROVED' : 'REJECTED';

      await withAudit(
        {
          userId: actor.userId,
          action: body.approve ? 'leave.approve' : 'leave.reject',
          entity: 'leaveRequest',
          entityId: id,
          changes: { status: { from: before.status, to: next } },
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.leaveRequest.update({
            where: { id },
            data: { status: next, approvedBy: actor.userId },
          });
        },
      );

      res.json(ok({ status: next }));
    } catch (error) {
      next(error);
    }
  },
);
