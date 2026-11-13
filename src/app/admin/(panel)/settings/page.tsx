/**
 * Settings — `/admin/settings` (Phase 10 pass B).
 *
 * A server component: it fetches the registry and the current user's permissions,
 * then hands both to the form. The form renders whatever the registry contains,
 * so this file never lists a field.
 *
 * `canWrite` comes from `/admin/me`, the same endpoint the sidebar uses. An
 * ORDER_MANAGER reaching this URL gets the page with every input disabled and a
 * banner, rather than a save button that would 403 — the API refuses them either
 * way, but a disabled form explains why.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type { SettingsGroup } from '@/lib/api/admin-settings';
import { SettingsForm } from '@/components/admin/settings-form';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

interface MeResponse {
  user: { id: string; name: string; role: string };
  permissions: string[];
}

export default async function SettingsPage() {
  const lang = await getLang();

  let groups: SettingsGroup[] = [];
  let canWrite = false;
  let error: string | null = null;

  try {
    // `adminFetchServer`, never the browser client: this is a server component,
    // and the browser half reads `document.cookie` for CSRF. Using it here sends
    // no session at all and the API answers "You must be signed in."
    const [settings, me] = await Promise.all([
      adminFetchServer<{ groups: SettingsGroup[] }>('/admin/settings'),
      adminFetchServer<MeResponse>('/admin/me'),
    ]);
    groups = settings.data.groups;
    canWrite = me.data.permissions.includes('settings:write');
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'সেটিংস লোড করা যায়নি।'
          : 'Could not load settings.';
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'সেটিংস' : 'Settings'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? 'দোকানের নাম, যোগাযোগ আর ডেলিভারি চার্জ — এখান থেকেই সব জায়গায় যায়।'
              : 'Store name, contact details and delivery charges — the values the rest of the shop reads.'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <SettingsForm lang={lang} groups={groups} canWrite={canWrite} />
      )}
    </>
  );
}
