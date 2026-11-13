/**
 * Admin audit API client.
 *
 * Mirrors `server/src/routes/admin/audit.ts`. Read-only: the audit trail is
 * append-only by design, so there is no write function here and there never
 * should be.
 */

import { adminFetch } from './admin-client';

export interface AuditEntry {
  id: string;
  userId: string;
  userName: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string;
  /** Before/after payload, shape varies by action. */
  changes: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  limit: number;
}

export async function listAudit(query: string): Promise<AuditListResponse> {
  const res = await adminFetch<AuditListResponse>(`/admin/audit?${query}`);
  return res.data;
}
