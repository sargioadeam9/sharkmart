/**
 * Admin expenses API client.
 *
 * Mirrors `server/src/routes/admin/expense.service.ts`. Money is integer poisha
 * on the wire; the form converts to taka with `toPoisha`/`toTaka`.
 */

import { adminFetch } from './admin-client';

export type ExpenseSort = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

export interface ExpenseItem {
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

export interface ExpenseListResponse {
  items: ExpenseItem[];
  total: number;
  page: number;
  limit: number;
  totalAmountPoisha: number;
}

export interface ExpenseSummary {
  from: string;
  to: string;
  totalPoisha: number;
  count: number;
  byCategory: Array<{ category: string; totalPoisha: number; count: number }>;
}

export interface ExpenseWriteBody {
  category?: string;
  description?: string;
  amountPoisha?: number;
  date?: string;
  receiptUrl?: string | null;
}

export async function listExpenses(query: string): Promise<ExpenseListResponse> {
  const res = await adminFetch<ExpenseListResponse>(`/admin/expenses?${query}`);
  return res.data;
}

export async function getExpenseSummary(query = ''): Promise<ExpenseSummary> {
  const res = await adminFetch<ExpenseSummary>(`/admin/expenses/summary${query ? `?${query}` : ''}`);
  return res.data;
}

export async function getExpenseCategories(): Promise<string[]> {
  const res = await adminFetch<{ categories: string[] }>('/admin/expenses/categories');
  return res.data.categories;
}

export async function createExpense(body: ExpenseWriteBody): Promise<ExpenseItem> {
  const res = await adminFetch<ExpenseItem>('/admin/expenses', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function updateExpense(id: string, body: ExpenseWriteBody): Promise<ExpenseItem> {
  const res = await adminFetch<ExpenseItem>(`/admin/expenses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function deleteExpense(id: string): Promise<void> {
  await adminFetch<{ deleted: boolean }>(`/admin/expenses/${id}`, { method: 'DELETE' });
}
