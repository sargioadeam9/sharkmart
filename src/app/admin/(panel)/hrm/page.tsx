/**
 * HRM — `/admin/hrm` (Phase 10 pass K).
 *
 * Server component: fetches the employees and the leave queue for today, and hands
 * both to the island. Attendance for the chosen day is fetched client-side so
 * marking a row can refresh just that table without a full navigation.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import { HrmScreen } from '@/components/admin/hrm-screen';

export const metadata: Metadata = {
  title: 'HRM',
  robots: { index: false, follow: false },
};

interface EmployeeRow {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  department: string | null;
  designation: string | null;
  joiningDate: string | null;
  salaryPoisha: number | null;
  isActive: boolean;
}

interface LeaveRow {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
}

export default async function HrmPage() {
  const lang = await getLang();
  const today = new Date().toISOString().slice(0, 10);

  let employees: EmployeeRow[] = [];
  let leaves: LeaveRow[] = [];
  let error: string | null = null;

  try {
    const [staff, queue] = await Promise.all([
      adminFetchServer<{ items: EmployeeRow[] }>('/admin/hrm/employees'),
      adminFetchServer<{ items: LeaveRow[] }>('/admin/hrm/leaves?status=all'),
    ]);
    employees = staff.data.items;
    leaves = queue.data.items;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'HRM লোড করা যায়নি।'
          : 'Could not load HRM.';
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'কর্মী ব্যবস্থাপনা' : 'HRM'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${employees.length} জন কর্মী · উপস্থিতি ও ছুটি`
              : `${employees.length} employees · attendance and leave`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <HrmScreen lang={lang} employees={employees} leaves={leaves} date={today} />
      )}
    </>
  );
}
