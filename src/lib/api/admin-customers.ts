/**
 * Admin customers API client (CRM). Mirrors `server/src/routes/admin/customers.ts`.
 */

import { adminFetch } from './admin-client';

export type CustomerSegment = 'all' | 'new' | 'returning' | 'high_value' | 'inactive';
export type CustomerSort = 'spend' | 'orders' | 'recent' | 'joined';

export interface CustomerListItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  orders: number;
  spendPoisha: number;
  lastOrderAt: string | null;
}

export interface CustomerListResponse {
  items: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface CustomerNote {
  id: string;
  body: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export interface CustomerProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  language: string;
  createdAt: string;
  stats: {
    orders: number;
    spendPoisha: number;
    averageOrderPoisha: number;
    lastOrderAt: string | null;
    wishlistCount: number;
    reviewCount: number;
    noteCount: number;
  };
  addresses: Array<{
    id: string;
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    area: string;
    address: string;
    isDefault: boolean;
  }>;
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    totalAmountPoisha: number;
    createdAt: string;
  }>;
  notes: CustomerNote[];
  notifications: Array<{
    id: string;
    type: string;
    channel: string;
    subject: string | null;
    status: string;
    createdAt: string;
    sentAt: string | null;
  }>;
}

export async function listCustomers(query: string): Promise<CustomerListResponse> {
  const res = await adminFetch<CustomerListResponse>(`/admin/customers?${query}`);
  return res.data;
}

export async function getCustomer(id: string): Promise<CustomerProfile> {
  const res = await adminFetch<CustomerProfile>(`/admin/customers/${id}`);
  return res.data;
}

export async function addCustomerNote(id: string, body: string): Promise<CustomerNote> {
  const res = await adminFetch<CustomerNote>(`/admin/customers/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  return res.data;
}

export async function deleteCustomerNote(id: string, noteId: string): Promise<void> {
  await adminFetch<{ deleted: boolean }>(`/admin/customers/${id}/notes/${noteId}`, {
    method: 'DELETE',
  });
}
