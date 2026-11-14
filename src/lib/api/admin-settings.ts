/**
 * Admin settings API client.
 *
 * Mirrors `server/src/services/settings.service.ts`. The registry lives on the
 * server; this file only describes its shape, so adding a setting never requires
 * touching the form — the screen renders whatever the API returns.
 */

import { adminFetch } from './admin-client';

export type SettingGroup = 'general' | 'contact' | 'commerce' | 'branding' | 'notifications';
export type SettingType = 'string' | 'int' | 'email' | 'url' | 'text' | 'boolean';

export interface SettingItem {
  key: string;
  group: SettingGroup;
  type: SettingType;
  labelEn: string;
  labelBn: string;
  hintEn?: string;
  hintBn?: string;
  value: string;
  default: string;
  isDefault: boolean;
}

export interface SettingsGroup {
  group: SettingGroup;
  items: SettingItem[];
}

export interface SettingsResponse {
  groups: SettingsGroup[];
}

export interface StoreProfile {
  name: string;
  tagline: string;
  domain: string;
  supportEmail: string;
  phone: string;
  address: string;
  nameFirst: string;
  nameSecond: string;
  logoUrl: string;
}

export async function getSettings(): Promise<SettingsGroup[]> {
  const res = await adminFetch<SettingsResponse>('/admin/settings');
  return res.data.groups;
}

export async function getStoreProfile(): Promise<StoreProfile> {
  const res = await adminFetch<StoreProfile>('/admin/settings/profile');
  return res.data;
}

export async function saveSettings(values: Record<string, string>): Promise<SettingsGroup[]> {
  const res = await adminFetch<SettingsResponse>('/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ values }),
  });
  return res.data.groups;
}
