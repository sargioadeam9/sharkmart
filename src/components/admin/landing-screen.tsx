'use client';

/**
 * Landing pages — the client island for `/admin/landing`.
 *
 * One table plus two overlays: create/edit, and the leads a page has collected.
 * The lead list is the reason a campaign page exists, so it is one click away
 * rather than buried in a report.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';

import { adminFetch, type AdminRequestOptions } from '@/lib/api/admin-client';

type Lang = 'en' | 'bn';

interface LandingItem {
  id: string;
  slug: string;
  title: string;
  campaignName: string | null;
  productId: string | null;
  productName: string | null;
  isActive: boolean;
  orderCount: number;
  createdAt: string;
}

interface Lead {
  id: string;
  name: string;
  phone: string;
  address: string;
  quantity: number;
  status: string;
  createdAt: string;
}

export function LandingScreen({ lang, items }: { lang: Lang; items: LandingItem[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [creating, setCreating] = useState(false);
  const [leadsFor, setLeadsFor] = useState<LandingItem | null>(null);
  const [busy, setBusy] = useState(false);

  // form
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [productId, setProductId] = useState('');
  const [headline, setHeadline] = useState('');
  const [bullets, setBullets] = useState('');

  async function call(path: string, options: AdminRequestOptions, success: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch(path, options);
      setNotice({ text: success, tone: 'ok' });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch('/admin/landing', {
        method: 'POST',
        body: {
          slug: slug.trim().toLowerCase(),
          title: title.trim(),
          campaignName: campaignName.trim() || null,
          productId: productId.trim() || null,
          content: {
            headline: headline.trim(),
            bullets: bullets
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
          },
        },
      });
      setCreating(false);
      setSlug('');
      setTitle('');
      setCampaignName('');
      setProductId('');
      setHeadline('');
      setBullets('');
      setNotice({ text: lang === 'bn' ? 'পেজ তৈরি হয়েছে' : 'Page created', tone: 'ok' });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
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

      <div className="prod-toolbar ord-toolbar">
        <div className="prod-search">
          <span className="cpn-hint">
            {lang === 'bn'
              ? 'একটা পেজ = একটা ক্যাম্পেইন + একটা পণ্য'
              : 'One page = one campaign + one product'}
          </span>
        </div>
        <div className="prod-filters">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            {lang === 'bn' ? 'নতুন পেজ' : 'New page'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'bn' ? 'শিরোনাম' : 'Title'}</th>
                <th scope="col">Slug</th>
                <th scope="col">{lang === 'bn' ? 'ক্যাম্পেইন' : 'Campaign'}</th>
                <th scope="col">{lang === 'bn' ? 'অর্ডার' : 'Leads'}</th>
                <th scope="col">{lang === 'bn' ? 'অবস্থা' : 'State'}</th>
                <th scope="col">{lang === 'bn' ? 'কাজ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td data-label={lang === 'bn' ? 'শিরোনাম' : 'Title'}>
                    <b>{row.title}</b>
                    {row.productName && <div className="cpn-sub">{row.productName}</div>}
                  </td>
                  <td data-label="Slug">
                    <code className="cpn-sub">/landing/{row.slug}</code>
                  </td>
                  <td data-label={lang === 'bn' ? 'ক্যাম্পেইন' : 'Campaign'}>
                    {row.campaignName ?? '—'}
                  </td>
                  <td data-label={lang === 'bn' ? 'অর্ডার' : 'Leads'}>{row.orderCount}</td>
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
                      <button type="button" className="btn ghost sm" onClick={() => setLeadsFor(row)}>
                        {lang === 'bn' ? 'লিড' : 'Leads'}
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={() =>
                          void call(
                            `/admin/landing/${row.id}/active`,
                            { method: 'POST', body: { isActive: !row.isActive } },
                            lang === 'bn' ? 'অবস্থা বদলানো হয়েছে' : 'State updated',
                          )
                        }
                      >
                        {row.isActive
                          ? lang === 'bn'
                            ? 'বন্ধ'
                            : 'Deactivate'
                          : lang === 'bn'
                            ? 'চালু'
                            : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <div className="overlay side open" onClick={() => setCreating(false)}>
          <div
            className="drawer cpn-drawer sup-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="New landing page"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>{lang === 'bn' ? 'নতুন ল্যান্ডিং পেজ' : 'New landing page'}</h2>
              <button type="button" className="x" onClick={() => setCreating(false)} aria-label="Close">
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="drawer-body">
              <label className="field">
                <span>Slug</span>
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                  placeholder="eid-offer-2026"
                  maxLength={80}
                />
                <small className="cpn-hint">
                  {lang === 'bn'
                    ? 'শুধু ছোট হাতের অক্ষর, সংখ্যা ও হাইফেন'
                    : 'Lowercase letters, digits and hyphens only'}
                </small>
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'শিরোনাম' : 'Title'}</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>{lang === 'bn' ? 'ক্যাম্পেইন' : 'Campaign'}</span>
                  <input
                    value={campaignName}
                    onChange={(event) => setCampaignName(event.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="field">
                  <span>{lang === 'bn' ? 'পণ্য আইডি' : 'Product id'}</span>
                  <input
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                    placeholder="uuid"
                  />
                </label>
              </div>

              <label className="field">
                <span>{lang === 'bn' ? 'হেডলাইন' : 'Headline'}</span>
                <input value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={160} />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'বুলেট (প্রতি লাইনে একটা)' : 'Bullets (one per line)'}</span>
                <textarea
                  value={bullets}
                  onChange={(event) => setBullets(event.target.value)}
                  rows={4}
                />
              </label>

              <p className="cpn-hint">
                {lang === 'bn'
                  ? 'দাম এখানে দেওয়া হয় না — পণ্যের নিজের দামই প্রযোজ্য।'
                  : 'No price here — the product’s own price applies.'}
              </p>
            </div>

            <div className="drawer-foot">
              <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void create()}
                disabled={busy || slug.trim().length < 3 || title.trim().length === 0}
              >
                {lang === 'bn' ? 'তৈরি করুন' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {leadsFor && <LeadsDrawer lang={lang} page={leadsFor} onClose={() => setLeadsFor(null)} />}
    </>
  );
}

function LeadsDrawer({
  lang,
  page,
  onClose,
}: {
  lang: Lang;
  page: LandingItem;
  onClose: () => void;
}) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<{ orders: Lead[] }>(`/admin/landing/${page.id}/orders`)
      .then((res) => {
        if (!cancelled) setLeads(res.data.orders);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [page.id]);

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer cpn-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Leads"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>
            {page.title} · {lang === 'bn' ? 'লিড' : 'Leads'}
          </h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="drawer-body">
          {error && (
            <div className="ord-notice is-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {!leads ? (
            <p className="cpn-hint">{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</p>
          ) : leads.length === 0 ? (
            <p className="cpn-hint">
              {lang === 'bn' ? 'এখনো কোনো লিড আসেনি।' : 'No leads yet.'}
            </p>
          ) : (
            <ul className="sup-list">
              {leads.map((lead) => (
                <li key={lead.id}>
                  <div>
                    <b>{lead.name}</b>
                    <div className="cpn-sub">
                      {lead.phone} · {lead.address}
                    </div>
                  </div>
                  <div className="sup-list-right">
                    <span className="badge info">×{lead.quantity}</span>
                    <span className={`badge ${lead.status === 'PENDING' ? 'warn' : 'ok'}`}>
                      {lead.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="cpn-hint">
            {lang === 'bn'
              ? 'লিড মানে অর্ডার নয় — কনফার্ম করতে স্বাভাবিক চেকআউট লাগবে।'
              : 'A lead is not an order — confirming it goes through the normal checkout.'}
          </p>
        </div>
      </div>
    </div>
  );
}
