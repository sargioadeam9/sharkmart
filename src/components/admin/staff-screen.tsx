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
import { KeyRound, X } from 'lucide-react';

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
    </>
  );
}
