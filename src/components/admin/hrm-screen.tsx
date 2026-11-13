'use client';

/**
 * HRM — the client island for `/admin/hrm`.
 *
 * Three sections on one screen because they are one job: who works here, who came
 * in today, and who is asking for time off. The leave queue is the actionable part
 * and it sits last only because it is read after the other two.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';

import { adminFetch } from '@/lib/api/admin-client';
import { formatMoneyAdmin } from '@/lib/format';

type Lang = 'en' | 'bn';

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

interface AttendanceRow {
  employeeId: string;
  name: string;
  department: string | null;
  status: string | null;
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

const STATUS_TONE: Record<string, string> = {
  PRESENT: 'ok',
  LATE: 'warn',
  HALF_DAY: 'warn',
  ABSENT: 'bad',
};

export function HrmScreen({
  lang,
  employees,
  leaves,
  date,
}: {
  lang: Lang;
  employees: EmployeeRow[];
  leaves: LeaveRow[];
  date: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  // employee form
  const [creating, setCreating] = useState(false);
  const [userId, setUserId] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [salary, setSalary] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminFetch<{ items: AttendanceRow[] }>(`/admin/hrm/attendance?date=${date}`)
      .then((res) => {
        if (!cancelled) setAttendance(res.data.items);
      })
      .catch(() => {
        if (!cancelled) setAttendance([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function mark(employeeId: string, status: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch('/admin/hrm/attendance', {
        method: 'POST',
        body: { employeeId, date, status },
      });
      const res = await adminFetch<{ items: AttendanceRow[] }>(`/admin/hrm/attendance?date=${date}`);
      setAttendance(res.data.items);
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch(`/admin/hrm/leaves/${id}/decide`, { method: 'POST', body: { approve } });
      setNotice({
        text: lang === 'bn' ? 'সিদ্ধান্ত সংরক্ষিত' : 'Decision saved',
        tone: 'ok',
      });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function createEmployee(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch('/admin/hrm/employees', {
        method: 'POST',
        body: {
          userId: userId.trim(),
          department: department.trim() || null,
          designation: designation.trim() || null,
          salaryPoisha: salary ? Math.round(Number(salary) * 100) : null,
        },
      });
      setCreating(false);
      setUserId('');
      setDepartment('');
      setDesignation('');
      setSalary('');
      setNotice({ text: lang === 'bn' ? 'কর্মী যোগ হয়েছে' : 'Employee added', tone: 'ok' });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const pending = leaves.filter((row) => row.status === 'PENDING');

  return (
    <>
      {notice && (
        <div
          className={`ord-notice${notice.tone === 'error' ? ' is-error' : ''}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <section className="card rep-card" style={{ marginBottom: 16 }}>
        <div className="sup-section-head">
          <h2>{lang === 'bn' ? 'কর্মী' : 'Employees'}</h2>
          <button type="button" className="btn ghost sm" onClick={() => setCreating((v) => !v)}>
            <Plus size={14} aria-hidden />
            {lang === 'bn' ? 'যোগ করুন' : 'Add'}
          </button>
        </div>

        {creating && (
          <div className="sup-new-po" style={{ marginBottom: 12 }}>
            <div className="field-row">
              <label className="field">
                <span>{lang === 'bn' ? 'ইউজার আইডি' : 'User id'}</span>
                <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="uuid" />
              </label>
              <label className="field">
                <span>{lang === 'bn' ? 'বিভাগ' : 'Department'}</span>
                <input value={department} onChange={(event) => setDepartment(event.target.value)} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>{lang === 'bn' ? 'পদ' : 'Designation'}</span>
                <input value={designation} onChange={(event) => setDesignation(event.target.value)} />
              </label>
              <label className="field">
                <span>{lang === 'bn' ? 'বেতন (৳)' : 'Salary (৳)'}</span>
                <input type="number" min={0} value={salary} onChange={(event) => setSalary(event.target.value)} />
              </label>
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={() => void createEmployee()}
              disabled={busy || userId.trim().length < 8}
            >
              {lang === 'bn' ? 'তৈরি করুন' : 'Create'}
            </button>
          </div>
        )}

        {employees.length === 0 ? (
          <p className="cpn-hint">{lang === 'bn' ? 'কোনো কর্মী নেই।' : 'No employees yet.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">{lang === 'bn' ? 'নাম' : 'Name'}</th>
                  <th scope="col">{lang === 'bn' ? 'বিভাগ' : 'Department'}</th>
                  <th scope="col">{lang === 'bn' ? 'পদ' : 'Designation'}</th>
                  <th scope="col">{lang === 'bn' ? 'বেতন' : 'Salary'}</th>
                  <th scope="col">{lang === 'bn' ? 'অবস্থা' : 'State'}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <tr key={row.id}>
                    <td data-label={lang === 'bn' ? 'নাম' : 'Name'}>
                      <b>{row.name}</b>
                      {row.email && <div className="cpn-sub">{row.email}</div>}
                    </td>
                    <td data-label={lang === 'bn' ? 'বিভাগ' : 'Department'}>{row.department ?? '—'}</td>
                    <td data-label={lang === 'bn' ? 'পদ' : 'Designation'}>{row.designation ?? '—'}</td>
                    <td data-label={lang === 'bn' ? 'বেতন' : 'Salary'}>
                      {row.salaryPoisha === null ? '—' : formatMoneyAdmin(row.salaryPoisha)}
                    </td>
                    <td data-label={lang === 'bn' ? 'অবস্থা' : 'State'}>
                      <span className={`badge ${row.isActive ? 'ok' : 'mute'}`}>
                        {row.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card rep-card" style={{ marginBottom: 16 }}>
        <h2>
          {lang === 'bn' ? 'আজকের উপস্থিতি' : 'Attendance'} · {date}
        </h2>

        {!attendance ? (
          <p className="cpn-hint">{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</p>
        ) : attendance.length === 0 ? (
          <p className="cpn-hint">{lang === 'bn' ? 'কোনো সক্রিয় কর্মী নেই।' : 'No active employees.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">{lang === 'bn' ? 'নাম' : 'Name'}</th>
                  <th scope="col">{lang === 'bn' ? 'অবস্থা' : 'Status'}</th>
                  <th scope="col">{lang === 'bn' ? 'চিহ্নিত করুন' : 'Mark'}</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((row) => (
                  <tr key={row.employeeId}>
                    <td data-label={lang === 'bn' ? 'নাম' : 'Name'}>{row.name}</td>
                    <td data-label={lang === 'bn' ? 'অবস্থা' : 'Status'}>
                      {row.status ? (
                        <span className={`badge ${STATUS_TONE[row.status] ?? 'mute'}`}>{row.status}</span>
                      ) : (
                        <span className="cpn-sub">{lang === 'bn' ? 'চিহ্নিত নয়' : 'unmarked'}</span>
                      )}
                    </td>
                    <td data-label={lang === 'bn' ? 'চিহ্নিত করুন' : 'Mark'}>
                      <div className="cpn-actions">
                        {(['PRESENT', 'LATE', 'ABSENT'] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            className="btn ghost sm"
                            disabled={busy}
                            onClick={() => void mark(row.employeeId, status)}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card rep-card">
        <h2>
          {lang === 'bn' ? 'ছুটির অনুরোধ' : 'Leave requests'}
          {pending.length > 0 && <span className="badge warn" style={{ marginLeft: 8 }}>{pending.length} pending</span>}
        </h2>

        {leaves.length === 0 ? (
          <p className="cpn-hint">{lang === 'bn' ? 'কোনো অনুরোধ নেই।' : 'No requests.'}</p>
        ) : (
          <ul className="sup-list">
            {leaves.map((row) => (
              <li key={row.id}>
                <div>
                  <b>{row.name}</b>
                  <div className="cpn-sub">
                    {row.type} · {row.startDate} → {row.endDate}
                    {row.reason ? ` · ${row.reason}` : ''}
                  </div>
                </div>
                <div className="sup-list-right">
                  <span
                    className={`badge ${
                      row.status === 'APPROVED' ? 'ok' : row.status === 'REJECTED' ? 'bad' : 'warn'
                    }`}
                  >
                    {row.status}
                  </span>
                  {row.status === 'PENDING' && (
                    <>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy}
                        onClick={() => void decide(row.id, true)}
                      >
                        <Check size={13} aria-hidden />
                        {lang === 'bn' ? 'অনুমোদন' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={() => void decide(row.id, false)}
                      >
                        {lang === 'bn' ? 'বাতিল' : 'Reject'}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
