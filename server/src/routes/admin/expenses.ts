/**
 * `/api/v1/admin/expenses` — Phase 10 pass C.
 *
 * Same mounting contract as every other admin module: rate limit, auth and the
 * staff gate live on `adminRouter`; this router adds only `requirePermission`.
 *
 * `/summary` and `/categories` are declared before `/:id` because Express matches
 * in declaration order — with `/:id` first they would be parsed as an expense id
 * and rejected by the uuid check.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  adminExpenseListQuery,
  expenseCreateBody,
  expenseIdParams,
  expenseSummaryQuery,
  expenseUpdateBody,
} from '../../validators/adminExpense.schema.js';
import {
  createExpense,
  deleteExpense,
  expenseCategories,
  expenseSummary,
  listExpenses,
  updateExpense,
  type Actor,
} from './expense.service.js';

export const expensesRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

// ─── Static paths first ────────────────────────────────────────────────────

expensesRouter.get(
  '/summary',
  requirePermission('settings:read'),
  validate({ query: expenseSummaryQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { from?: string; to?: string };
      res.json(ok(await expenseSummary(query.from, query.to)));
    } catch (error) {
      next(error);
    }
  },
);

expensesRouter.get('/categories', requirePermission('settings:read'), async (_req, res, next) => {
  try {
    res.json(ok({ categories: await expenseCategories() }));
  } catch (error) {
    next(error);
  }
});

// ─── List ──────────────────────────────────────────────────────────────────

expensesRouter.get(
  '/',
  requirePermission('settings:read'),
  validate({ query: adminExpenseListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as Parameters<typeof listExpenses>[0];
      res.json(ok(await listExpenses(query)));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Create ────────────────────────────────────────────────────────────────

expensesRouter.post(
  '/',
  requirePermission('settings:write'),
  validate({ body: expenseCreateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof createExpense>[0];
      res.status(201).json(ok(await createExpense(body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Update ────────────────────────────────────────────────────────────────

expensesRouter.patch(
  '/:id',
  requirePermission('settings:write'),
  validate({ params: expenseIdParams, body: expenseUpdateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof updateExpense>[1];
      res.json(ok(await updateExpense(req.params.id!, body, actorFrom(req))));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Delete ────────────────────────────────────────────────────────────────

expensesRouter.delete(
  '/:id',
  requirePermission('settings:write'),
  validate({ params: expenseIdParams }),
  async (req, res, next) => {
    try {
      await deleteExpense(req.params.id!, actorFrom(req));
      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  },
);
