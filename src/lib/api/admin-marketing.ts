/**
 * Admin marketing API client. Mirrors `server/src/routes/admin/marketing.ts`.
 */

import { adminFetch } from './admin-client';

export type CampaignSegment = 'all' | 'new' | 'returning' | 'high_value' | 'inactive';
export type Channel = 'SMS' | 'EMAIL';

export interface SmsTemplate {
  id: string;
  name: string;
  templateEn: string;
  templateBn: string;
  type: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subjectEn: string;
  subjectBn: string;
  bodyEn: string;
  bodyBn: string;
  type: string;
}

export interface TemplatesResponse {
  sms: SmsTemplate[];
  email: EmailTemplate[];
}

export interface ComposePreview {
  recipients: number;
  sample: {
    to: string | null;
    name: string | null;
    subject: string | null;
    body: string;
  };
}

export interface CampaignReport {
  counts: Record<string, number>;
  recent: Array<{
    id: string;
    channel: Channel;
    subject: string | null;
    status: string;
    recipientName: string | null;
    createdAt: string;
    sentAt: string | null;
  }>;
}

export async function getTemplates(): Promise<TemplatesResponse> {
  const res = await adminFetch<TemplatesResponse>('/admin/marketing/templates');
  return res.data;
}

export async function createSmsTemplate(body: {
  name: string;
  templateEn: string;
  templateBn: string;
  type?: 'TRANSACTIONAL' | 'PROMOTIONAL';
}): Promise<{ id: string }> {
  const res = await adminFetch<{ id: string }>('/admin/marketing/templates/sms', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function compose(body: {
  channel: Channel;
  templateId: string;
  segment: CampaignSegment;
  language: 'bn' | 'en';
  preview: boolean;
}): Promise<ComposePreview | { queued: number; note: string }> {
  const res = await adminFetch<ComposePreview | { queued: number; note: string }>(
    '/admin/marketing/compose',
    { method: 'POST', body: JSON.stringify(body) },
  );
  return res.data;
}

export async function getReport(channel?: Channel): Promise<CampaignReport> {
  const res = await adminFetch<CampaignReport>(
    `/admin/marketing/report${channel ? `?channel=${channel}` : ''}`,
  );
  return res.data;
}
