'use client';

/**
 * Staff and roles — the client island for `/admin/roles`.
 *
 * Your own row is visibly different: the role select and the active toggle are
 * disabled with "you" beside the name. The API refuses those changes anyway, but a
 * control that would 409 is worse than a control that explains why it is off.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Plus, Trash2, X } from 'lucide-react';

import { adminFetch, type AdminRequestOptions } from '@/lib/api/admin-client';

type Lang = 'en' | 'bn';

const ROLE_LABEL: Record<string, { en: string; bn: string }> = {
  SUPER_ADMIN: { en: 'Super admin', bn: 'সুপার অ্যাডমিন' },
  ADMIN: { en: 'Admin', bn: 'অ্যাডমিন' },
  ORDER_MANAGER: { en: 'Order manager', bn: 'অর্ডার ম্যানেজার' },
  INVENTORY_STAFF: { en: 'Inventory staff', bn: 'স্টক স্টাফ' },
  MARKETING_STAFF: { en: 'Marketing staff', bn: 'মার্কেটিং স্টাফ' },
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

export function StaffScreen({
  lang,
  items,
  roles,
  currentUserId,
}: {
  lang: Lang;
  items: StaffItem[];
  roles: string[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * The create drawer's own state.
   *
   * Kept here rather than in a separate component because it shares `call()`,
   * the notice strip and the refresh — a second island would duplicate all
   * three to save a dozen lines.
   */
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'ORDER_MANAGER',
    password: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function call(path: string, options: AdminRequestOptions, success: string): Promise<void> {
    setBusy(path);
    setNotice(null);
    try {
      await adminFetch(path, options);
      setNotice({ text: success, tone: 'ok' });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function createStaff(): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      await adminFetch('/admin/staff', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          role: form.role,
          password: form.password,
        },
      });
      setCreating(false);
      setForm({ name: '', email: '', phone: '', role: 'ORDER_MANAGER', password: '' });
      setNotice({
        text:
          lang === 'bn'
            ? 'কর্মী তৈরি হয়েছে। পাসওয়ার্ডটি তাকে জানিয়ে দিন।'
            : 'Staff member created. Pass the password on to them.',
        tone: 'ok',
      });
      router.refresh();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: StaffItem): Promise<void> {
    const confirmed = window.confirm(
      lang === 'bn'
        ? `${row.name}-এর অ্যাকাউন্ট মুছে ফেলবেন? এটি ফেরানো যাবে না।`
        : `Delete ${row.name}'s account? This cannot be undone.`,
    );
    if (!confirmed) return;

    await call(
      `/admin/staff/${row.id}`,
      { method: 'DELETE' },
      lang === 'bn' ? 'অ্যাকাউন্ট মুছে ফেলা হয়েছে' : 'Account deleted',
    );
  }

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

      <div className="prod-toolbar ord-toolbar">
        <span className="cpn-hint">
          {lang === 'bn'
            ? 'নতুন কর্মী যোগ করলে সে সাথে সাথেই সাইন ইন করতে পারবে।'
            : 'A new staff member can sign in immediately.'}
        </span>
        <button type="button" className="btn" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden />
          {lang === 'bn' ? 'নতুন কর্মী' : 'New staff'}
        </button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'bn' ? 'নাম' : 'Name'}</th>
                <th scope="col">{lang === 'bn' ? 'রোল' : 'Role'}</th>
                <th scope="col">{lang === 'bn' ? 'অনুমতি' : 'Permissions'}</th>
                <th scope="col">{lang === 'bn' ? 'সেশন' : 'Sessions'}</th>
                <th scope="col">{lang === 'bn' ? 'অবস্থা' : 'State'}</th>
                <th scope="col">{lang === 'bn' ? 'কাজ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const isSelf = row.id === currentUserId;

                return (
                  <tr key={row.id}>
                    <td data-label={lang === 'bn' ? 'নাম' : 'Name'}>
                      <b>{row.name}</b>
                      {isSelf && <span className="badge info" style={{ marginLeft: 8 }}>you</span>}
                      <div className="cpn-sub">{row.email ?? row.phone ?? '—'}</div>
                    </td>

                    <td data-label={lang === 'bn' ? 'রোল' : 'Role'}>
                      <select
                        value={row.role}
                        disabled={isSelf || busy === `/admin/staff/${row.id}/role`}
                        onChange={(event) =>
                          void call(
                            `/admin/staff/${row.id}/role`,
                            { method: 'PATCH', body: { role: event.target.value } },
                            lang === 'bn' ? 'রোল বদলানো হয়েছে' : 'Role updated',
                          )
                        }
                        aria-label={`${row.name} role`}
                      >
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]?.[lang] ?? role}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td data-label={lang === 'bn' ? 'অনুমতি' : 'Permissions'}>
                      {row.permissions.length}
                    </td>

                    <td data-label={lang === 'bn' ? 'সেশন' : 'Sessions'}>{row.sessions}</td>

                    <td data-label={lang === 'bn' ? 'অবস্থা' : 'State'}>
                      <span className={`badge ${row.isActive ? 'ok' : 'mute'}`}>
                        {row.isActive
                          ? lang === 'bn'
                            ? 'সক্রিয়'
                            : 'Active'
                          : lang === 'bn'
                            ? 'নিষ্ক্রিয়'
                            : 'Inactive'}
                      </span>
                    </td>

                    <td data-label={lang === 'bn' ? 'কাজ' : 'Actions'}>
                      <div className="cpn-actions">
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={isSelf || busy === `/admin/staff/${row.id}/active`}
                          onClick={() =>
                            void call(
                              `/admin/staff/${row.id}/active`,
                              { method: 'POST', body: { isActive: !row.isActive } },
                              lang === 'bn' ? 'অবস্থা বদলানো হয়েছে' : 'State updated',
                            )
                          }
                        >
                          {row.isActive
                            ? lang === 'bn'
                              ? 'নিষ্ক্রিয়'
                              : 'Deactivate'
                            : lang === 'bn'
                              ? 'সক্রিয়'
                              : 'Activate'}
                        </button>

                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy === `/admin/staff/${row.id}/revoke-sessions`}
                          onClick={() =>
                            void call(
                              `/admin/staff/${row.id}/revoke-sessions`,
                              { method: 'POST' },
                              lang === 'bn'
                                ? 'সেশন বাতিল হয়েছে'
                                : 'Sessions revoked',
                            )
                          }
                        >
                          <KeyRound size={13} aria-hidden />
                          {lang === 'bn' ? 'সেশন বাতিল' : 'Revoke sessions'}
                        </button>

                        {/**
                         * Delete is refused by the API for three reasons —
                         * yourself, the last super admin, or an account with
                         * orders — and the refusal comes back as a sentence in
                         * the notice strip. The button stays enabled so the
                         * reason is explained rather than the control silently
                         * disappearing.
                         */}
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={isSelf || busy === `/admin/staff/${row.id}`}
                          onClick={() => void remove(row)}
                        >
                          <Trash2 size={13} aria-hidden />
                          {lang === 'bn' ? 'মুছুন' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="cpn-hint" style={{ marginTop: 14 }}>
        {lang === 'bn'
          ? 'নিজের রোল বা সক্রিয় অবস্থা বদলানো যায় না — অ্যাক্সেস হারানোর সবচেয়ে সাধারণ কারণ এটাই। সেশন বাতিল করলে access token মেয়াদ শেষ পর্যন্ত বৈধ থাকে (সর্বোচ্চ ১৫ মিনিট)।'
          : 'You cannot change your own role or deactivate yourself — that is the most common way to lose access. Revoking sessions leaves access tokens valid until they expire (up to 15 minutes).'}
      </p>

      {creating && (
        <div className="overlay side open" onClick={() => setCreating(false)}>
          <div
            className="drawer cpn-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'bn' ? 'নতুন কর্মী' : 'New staff'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>{lang === 'bn' ? 'নতুন কর্মী' : 'New staff'}</h2>
              <button type="button" className="x" onClick={() => setCreating(false)} aria-label="Close">
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="drawer-body">
              {formError && (
                <div className="ord-notice is-error" role="alert">
                  <span>{formError}</span>
                </div>
              )}

              <label className="field">
                <span>{lang === 'bn' ? 'নাম' : 'Name'}</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  maxLength={120}
                  autoFocus
                />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'ইমেইল' : 'Email'}</span>
                <input
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  maxLength={254}
                  autoComplete="off"
                />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'মোবাইল (ঐচ্ছিক)' : 'Mobile (optional)'}</span>
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  maxLength={20}
                />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'রোল' : 'Role'}</span>
                <select
                  value={form.role}
                  onChange={(event) => setForm({ ...form, role: event.target.value })}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]?.[lang] ?? role}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}</span>
                <input
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  type="text"
                  maxLength={128}
                  autoComplete="new-password"
                />
                <small className="cpn-hint">
                  {lang === 'bn'
                    ? 'কমপক্ষে ৮ অক্ষর। কর্মীকে জানিয়ে দিন — পরে সে নিজে বদলে নিতে পারবে।'
                    : 'At least 8 characters. Pass it on — they can change it from their profile.'}
                </small>
              </label>
            </div>

            <div className="drawer-foot">
              <button type="button" className="btn ghost" onClick={() => setCreating(false)} disabled={saving}>
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void createStaff()}
                disabled={
                  saving ||
                  form.name.trim().length < 2 ||
                  !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()) ||
                  form.password.length < 8
                }
              >
                {saving ? (lang === 'bn' ? 'তৈরি হচ্ছে…' : 'Creating…') : lang === 'bn' ? 'তৈরি করুন' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
