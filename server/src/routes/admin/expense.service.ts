/**
 * `/api/v1/admin/expenses` — Phase 10 pass C.
 *
 * ── Why the permission is `settings:*` ──────────────────────────────────────
 *
 * There is no `expenses:*` in the permission matrix (`security.md` §6), and this
 * module does not invent one: expenses are money records, and the matrix already
 * gives exactly the right audience — `settings:read` / `settings:write` are held
 * by ADMIN and SUPER_ADMIN only. Reusing them means an operator cannot see the
 * shop's costs just because they can read orders.
 *
 * ── Dates ──────────────────────────────────────────────────────────────────
 *
 * `date` is a calendar day, not a timestamp. It is stored at UTC midnight and
 * read back as `YYYY-MM-DD`, so an expense recorded on the 5th is on the 5th in
 * every timezone the report is opened in. Storing "now" would make the same row
 * fall on different days depending on where it is read.
 *
 * ── Deletion ───────────────────────────────────────────────────────────────
 *
 * Unlike orders and coupons, an expense has no downstream references — nothing
 * else points at it, so a hard delete is honest. The audit row keeps the value.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { notFound } from '../../middleware/errorHandler.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';
import type {
  ExpenseCreateInput,
  ExpenseListQuery,
  ExpenseUpdateInput,
} from '../../validators/adminExpense.schema.js';

export interface Actor {
  userId: string;
  ipAddress: string | null;
}

export interface ExpenseRow {
  id: string;
  category: string;
  description: string;
  amountPoisha: number;
  /** `YYYY-MM-DD`. */
  date: string;
  receiptUrl: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

const EXPENSE_SELECT = {
  id: true,
  category: true,
  description: true,
  amountPoisha: true,
  date: true,
  receiptUrl: true,
  createdBy: true,
  createdAt: true,
} satisfies Prisma.ExpenseSelect;

type ExpenseDbRow = Prisma.ExpenseGetPayload<{ select: typeof EXPENSE_SELECT }>;

/** UTC midnight for a `YYYY-MM-DD` string. */
function dayStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** UTC end-of-day, so `to=2026-11-13` includes the 13th. */
function dayEnd(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function toDto(row: ExpenseDbRow, name: string | null): ExpenseRow {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    amountPoisha: row.amountPoisha,
    date: row.date.toISOString().slice(0, 10),
    receiptUrl: row.receiptUrl,
    createdBy: row.createdBy,
    createdByName: name,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Resolves `createdBy` ids to names in one query for the whole page. */
async function namesFor(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

export interface ExpenseListResult {
  items: ExpenseRow[];
  total: number;
  page: number;
  limit: number;
  /** Sum of every row matching the filter, not just this page. */
  totalAmountPoisha: number;
}

export async function listExpenses(query: ExpenseListQuery): Promise<ExpenseListResult> {
  const where: Prisma.ExpenseWhereInput = {
    ...(query.category ? { category: query.category } : {}),
    ...(query.q
      ? {
          OR: [
            { description: { contains: query.q } },
            { category: { contains: query.q } },
          ],
        }
      : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: dayStart(query.from) } : {}),
            ...(query.to ? { lte: dayEnd(query.to) } : {}),
          },
        }
      : {}),
  };

  const orderBy: Prisma.ExpenseOrderByWithRelationInput[] =
    query.sort === 'oldest'
      ? [{ date: 'asc' }, { createdAt: 'asc' }]
      : query.sort === 'amount_desc'
        ? [{ amountPoisha: 'desc' }]
        : query.sort === 'amount_asc'
          ? [{ amountPoisha: 'asc' }]
          : [{ date: 'desc' }, { createdAt: 'desc' }];

  const skip = (query.page - 1) * query.limit;

  const [rows, total, sum] = await Promise.all([
    prisma.expense.findMany({ where, select: EXPENSE_SELECT, orderBy, skip, take: query.limit }),
    prisma.expense.count({ where }),
    // The strip above the table must show the filtered total, not the page's.
    prisma.expense.aggregate({ where, _sum: { amountPoisha: true } }),
  ]);

  const names = await namesFor(rows.map((row) => row.createdBy));

  return {
    items: rows.map((row) => toDto(row, names.get(row.createdBy) ?? null)),
    total,
    page: query.page,
    limit: query.limit,
    totalAmountPoisha: sum._sum.amountPoisha ?? 0,
  };
}

export interface ExpenseSummary {
  from: string;
  to: string;
  totalPoisha: number;
  count: number;
  byCategory: Array<{ category: string; totalPoisha: number; count: number }>;
}

/**
 * Totals for the range, grouped by category.
 *
 * Defaults to the current month so the screen has something meaningful on first
 * load without the operator picking dates.
 */
export async function expenseSummary(
  from: string | undefined,
  to: string | undefined,
  now = new Date(),
): Promise<ExpenseSummary> {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  const start = from ?? first.toISOString().slice(0, 10);
  const end = to ?? last.toISOString().slice(0, 10);

  const where: Prisma.ExpenseWhereInput = { date: { gte: dayStart(start), lte: dayEnd(end) } };

  const [grouped, total] = await Promise.all([
    prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: { amountPoisha: true },
      _count: { _all: true },
      orderBy: { _sum: { amountPoisha: 'desc' } },
    }),
    prisma.expense.aggregate({ where, _sum: { amountPoisha: true }, _count: { _all: true } }),
  ]);

  return {
    from: start,
    to: end,
    totalPoisha: total._sum.amountPoisha ?? 0,
    count: total._count._all,
    byCategory: grouped.map((row) => ({
      category: row.category,
      totalPoisha: row._sum.amountPoisha ?? 0,
      count: row._count._all,
    })),
  };
}

/** The categories already in use, for the form's suggestions. */
export async function expenseCategories(): Promise<string[]> {
  const rows = await prisma.expense.groupBy({ by: ['category'], orderBy: { category: 'asc' } });
  return rows.map((row) => row.category);
}

export async function createExpense(input: ExpenseCreateInput, actor: Actor): Promise<ExpenseRow> {
  const created = await withAudit<ExpenseDbRow>(
    (row) => ({
      userId: actor.userId,
      action: 'expense.create',
      entity: 'expense',
      entityId: row.id,
      changes: { after: row as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    }),
    async (tx) =>
      tx.expense.create({
        data: {
          category: input.category,
          description: input.description,
          amountPoisha: input.amountPoisha,
          date: dayStart(input.date),
          receiptUrl: input.receiptUrl ?? null,
          createdBy: actor.userId,
        },
        select: EXPENSE_SELECT,
      }),
  );

  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  return toDto(created, me?.name ?? null);
}

export async function updateExpense(
  id: string,
  input: ExpenseUpdateInput,
  actor: Actor,
): Promise<ExpenseRow> {
  const before = await prisma.expense.findUnique({ where: { id }, select: EXPENSE_SELECT });
  if (!before) throw notFound('Expense');

  const data: Prisma.ExpenseUpdateInput = {};
  if (input.category !== undefined) data.category = input.category;
  if (input.description !== undefined) data.description = input.description;
  if (input.amountPoisha !== undefined) data.amountPoisha = input.amountPoisha;
  if (input.date !== undefined) data.date = dayStart(input.date);
  if (input.receiptUrl !== undefined) data.receiptUrl = input.receiptUrl;

  const changes = diffChanges(
    before as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  const updated = await withAudit<ExpenseDbRow>(
    {
      userId: actor.userId,
      action: 'expense.update',
      entity: 'expense',
      entityId: id,
      changes: changes as Prisma.InputJsonValue,
      ipAddress: actor.ipAddress,
    },
    async (tx) => tx.expense.update({ where: { id }, data, select: EXPENSE_SELECT }),
  );

  const names = await namesFor([updated.createdBy]);
  return toDto(updated, names.get(updated.createdBy) ?? null);
}

export async function deleteExpense(id: string, actor: Actor): Promise<void> {
  const before = await prisma.expense.findUnique({ where: { id }, select: EXPENSE_SELECT });
  if (!before) throw notFound('Expense');

  await withAudit(
    {
      userId: actor.userId,
      action: 'expense.delete',
      entity: 'expense',
      entityId: id,
      // The row is gone after this, so the audit entry is the only remaining
      // record of what was deleted and for how much.
      changes: { before: before as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.expense.delete({ where: { id } });
    },
  );
}
