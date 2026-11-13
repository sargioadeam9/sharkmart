/**
 * Admin reports — types and the export URL builder.
 *
 * The screen is a server component and fetches through `adminFetchServer`, so this
 * file carries no fetch wrapper of its own. `exportUrl` is here because the export
 * is a plain link: a download must not go through JavaScript, and the browser
 * sends the session cookie on the navigation.
 */

import { API_BASE_URL, API_PREFIX } from './config';

export interface ReportSummary {
  orders: number;
  revenuePoisha: number;
  discountPoisha: number;
  deliveryPoisha: number;
  averageOrderPoisha: number;
  deliveredOrders: number;
  deliveredRevenuePoisha: number;
  expensesPoisha: number;
  revenueMinusExpensesPoisha: number;
}

export interface ReportSeriesPoint {
  day: string;
  orders: number;
  revenuePoisha: number;
}

export interface ReportProductRow {
  productId: string;
  nameEn: string;
  sku: string;
  quantity: number;
  revenuePoisha: number;
}

export interface ReportGroupRow {
  id: string;
  name: string;
  quantity: number;
  revenuePoisha: number;
}

export interface ReportPayload {
  from: string;
  to: string;
  summary: ReportSummary;
  series: ReportSeriesPoint[];
  topProducts: ReportProductRow[];
  categories: ReportGroupRow[];
  brands: ReportGroupRow[];
}

/** Absolute URL for the CSV download, carrying the current range. */
export function exportUrl(type: 'orders' | 'products', from: string, to: string): string {
  const params = new URLSearchParams({ type, from, to });
  return `${API_BASE_URL}${API_PREFIX}/admin/reports/export?${params.toString()}`;
}
