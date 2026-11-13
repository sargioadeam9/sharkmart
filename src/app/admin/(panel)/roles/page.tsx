/**
 * Roles and security — `/admin/roles` (Phase 10 pass I).
 *
 * Server component: fetches the staff list and the current user's id (so the
 * island can disable the controls on your own row) and renders the table.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import { StaffScreen } from '@/components/admin/staff-screen';

export const metadata: Metadata = {
  title: 'Roles and security',
  robots: { index: false, follow: false },
};

interface StaffItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  sessions: number;
  permissions: string[];
}

interface MeResponse {
  user: { id: string; name: string; role: string };
}

export default async function RolesPage() {
  const lang = await getLang();

  let items: StaffItem[] = [];
  let roles: string[] = [];
  let currentUserId = '';
  let error: string | null = null;

  try {
    const [staff, me] = await Promise.all([
      adminFetchServer<{ items: StaffItem[]; roles: string[] }>('/admin/staff'),
      adminFetchServer<MeResponse>('/admin/me'),
    ]);
    items = staff.data.items;
    roles = staff.data.roles;
    currentUserId = me.data.user.id;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'স্টাফ তালিকা লোড করা যায়নি।'
          : 'Could not load the staff list.';
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'রোল ও নিরাপত্তা' : 'Roles and security'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${items.length} জন স্টাফ · প্রতিটা পরিবর্তন অডিট হয়`
              : `${items.length} staff · every change is audited`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <StaffScreen lang={lang} items={items} roles={roles} currentUserId={currentUserId} />
      )}
    </>
  );
}
