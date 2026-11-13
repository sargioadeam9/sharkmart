/**
 * Zod schemas for `/api/v1/admin/expenses` (Phase 10 pass C).
 *
 * Expenses are money records, so the same rules as every other amount in this
 * project apply: integer poisha on the wire, never a float, never taka. The admin
 * form converts; the API does not.
 *
 * `category` is a free string rather than an enum on purpose — a shop's expense
 * categories are its own (rent, salary, courier, packaging, marketing...), and an
 * enum would mean a migration every time an operator thinks of a new one. The
 * screen suggests the ones already in use.
 */

import { z } from 'zod';

const poisha = z.number().int().min(1, 'amount must be greater than zero');

/** A date the form sends as `YYYY-MM-DD`. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const expenseIdParams = z.object({ id: z.string().uuid() }).strict();

export const adminExpenseListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    category: z.string().trim().max(60).optional(),
    /** Inclusive range on `date`. Both optional, both independent. */
    from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['newest', 'oldest', 'amount_desc', 'amount_asc']).default('newest'),
  })
  .strict();

const expenseFields = {
  category: z.string().trim().min(1, 'category is required').max(60),
  description: z.string().trim().min(1, 'description is required').max(300),
  amountPoisha: poisha,
  date: isoDate,
  /**
   * A link to a scanned receipt. There is no upload storage in this project, so
   * this is a URL the operator already has (Drive, a courier's portal, an email).
   */
  receiptUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (value) => value === '' || /^https?:\/\//i.test(value),
      'receiptUrl must start with http:// or https://',
    )
    .nullable()
    .optional(),
};

export const expenseCreateBody = z.object(expenseFields).strict();

export const expenseUpdateBody = z
  .object({
    category: expenseFields.category.optional(),
    description: expenseFields.description.optional(),
    amountPoisha: poisha.optional(),
    date: isoDate.optional(),
    receiptUrl: expenseFields.receiptUrl,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

/** The summary strip's range. Defaults to the current month. */
export const expenseSummaryQuery = z
  .object({
    from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export type ExpenseCreateInput = z.infer<typeof expenseCreateBody>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateBody>;
export type ExpenseListQuery = z.infer<typeof adminExpenseListQuery>;
