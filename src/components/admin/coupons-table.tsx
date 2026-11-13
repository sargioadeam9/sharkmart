'use client';

/**
 * The coupon screen's client island.
 *
 * Holds the toolbar, the table, the create/edit drawer and the redemption report.
 * The drawer is opened by the URL (`?new=1`, `?edit=<id>`, `?redeem=<id>`) rather
 * than by local state, so a half-filled form survives a refresh and the browser's
 * back button closes it — the same reason every filter on this panel is a query
 * param.
 *
 * Money in the form is entered in taka and converted with `toPoisha`/`toTaka`.
 * The API takes poisha only; a form that sent taka would create a coupon worth
 * one hundredth of what the operator typed, which is the kind of bug that only
 * shows up in a customer complaint.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';

import { formatMoneyAdmin, toPoisha, toTaka } from '@/lib/format';
import {
  createCoupon,
  deleteCoupon,
  listRedemptions,
  setCouponActive,
  updateCoupon,
  type CouponListItem,
  type CouponRedemption,
  type CouponState,
  type CouponStateFilter,
  type CouponType,
  type CouponWriteBody,
} from '@/lib/api/admin-coupons';

type Lang = 'en' | 'bn';

const STATE_TONE: Record<CouponState, string> = {
  live: 'ok',
  scheduled: 'info',
  expired: 'mute',
  exhausted: 'warn',
  inactive: 'bad',
};

const STATE_LABEL: Record<CouponState, { en: string; bn: string }> = {
  live: { en: 'Live', bn: 'চালু' },
  scheduled: { en: 'Scheduled', bn: 'নির্ধারিত' },
  expired: { en: 'Expired', bn: 'মেয়াদোত্তীর্ণ' },
  exhausted: { en: 'Exhausted', bn: 'শেষ' },
  inactive: { en: 'Inactive', bn: 'নিষ্ক্রিয়' },
};

const TYPE_LABEL: Record<CouponType, { en: string; bn: string }> = {
  FIXED: { en: 'Fixed', bn: 'নির্দিষ্ট' },
  PERCENTAGE: { en: 'Percentage', bn: 'শতাংশ' },
  FREE_DELIVERY: { en: 'Free delivery', bn: 'ফ্রি ডেলিভারি' },
};

function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** "৳500 off" / "20% off" / "Free delivery" — one line, no ambiguity. */
function describeValue(row: CouponListItem, lang: Lang): string {
  if (row.type === 'FREE_DELIVERY') {
    return lang === 'bn' ? 'ফ্রি ডেলিভারি' : 'Free delivery';
  }
  if (row.type === 'PERCENTAGE') {
    return lang === 'bn' ? `${row.value}% ছাড়` : `${row.value}% off`;
  }
  return lang === 'bn'
    ? `${formatMoneyAdmin(row.value)} ছাড়`
    : `${formatMoneyAdmin(row.value)} off`;
}

// ─── Toolbar ────────────────────────────────────────────────────────────────

interface ToolbarProps {
  lang: Lang;
  initialQuery: string;
  type: string;
  sort: string;
  state: CouponStateFilter;
}

export function CouponsToolbar({ lang, initialQuery, type, sort, state }: ToolbarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function build(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams();
    if (state !== 'all') next.set('state', state);
    if (type) next.set('type', type);
    if (sort !== 'newest') next.set('sort', sort);
    const q = overrides.q ?? initialQuery;
    if (q) next.set('q', q);
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'q') continue;
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/offers?${next.toString()}`;
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => router.push(build({ q: value || undefined })), 350);
  }

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  return (
    <div className="prod-toolbar ord-toolbar">
      <div className="prod-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={lang === 'bn' ? 'কুপন কোড' : 'Coupon code'}
          aria-label={lang === 'bn' ? 'কুপন খুঁজুন' : 'Search coupons'}
        />
      </div>

      <div className="prod-filters">
        <select
          value={type}
          onChange={(event) => router.push(build({ type: event.target.value || undefined }))}
          aria-label={lang === 'bn' ? 'ধরন' : 'Type'}
        >
          <option value="">{lang === 'bn' ? 'সব ধরন' : 'All types'}</option>
          <option value="FIXED">{TYPE_LABEL.FIXED[lang]}</option>
          <option value="PERCENTAGE">{TYPE_LABEL.PERCENTAGE[lang]}</option>
          <option value="FREE_DELIVERY">{TYPE_LABEL.FREE_DELIVERY[lang]}</option>
        </select>

        <select
          value={sort}
          onChange={(event) => router.push(build({ sort: event.target.value }))}
          aria-label={lang === 'bn' ? 'সাজান' : 'Sort'}
        >
          <option value="newest">{lang === 'bn' ? 'নতুন আগে' : 'Newest first'}</option>
          <option value="oldest">{lang === 'bn' ? 'পুরোনো আগে' : 'Oldest first'}</option>
          <option value="used">{lang === 'bn' ? 'বেশি ব্যবহৃত' : 'Most used'}</option>
          <option value="ending">{lang === 'bn' ? 'শীঘ্রই শেষ' : 'Ending soon'}</option>
        </select>

        <button
          type="button"
          className="btn"
          onClick={() => router.push(build({ new: '1' }))}
        >
          <Plus size={16} aria-hidden />
          {lang === 'bn' ? 'নতুন কুপন' : 'New coupon'}
        </button>
      </div>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: CouponListItem[];
  total: number;
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  queryString: string;
  openNew: boolean;
  editId: string | null;
  redeemId: string | null;
}

export function CouponsTable({
  lang,
  items,
  total,
  page,
  totalPages,
  prevHref,
  nextHref,
  queryString,
  openNew,
  editId,
  redeemId,
}: TableProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const editing = editId ? items.find((row) => row.id === editId) ?? null : null;
  const redeeming = redeemId ? items.find((row) => row.id === redeemId) ?? null : null;

  function close(): void {
    const next = new URLSearchParams(queryString);
    next.delete('new');
    next.delete('edit');
    next.delete('redeem');
    router.push(`/admin/offers?${next.toString()}`);
  }

  function open(key: 'edit' | 'redeem', id: string): void {
    const next = new URLSearchParams(queryString);
    next.delete('new');
    next.set(key, id);
    router.push(`/admin/offers?${next.toString()}`);
  }

  async function toggle(row: CouponListItem): Promise<void> {
    try {
      await setCouponActive(row.id, !row.isActive);
      setNotice({
        text:
          lang === 'bn'
            ? `${row.code} ${row.isActive ? 'নিষ্ক্রিয়' : 'চালু'} করা হয়েছে`
            : `${row.code} is now ${row.isActive ? 'inactive' : 'active'}`,
        tone: 'ok',
      });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    }
  }

  async function remove(row: CouponListItem): Promise<void> {
    try {
      await deleteCoupon(row.id);
      setPendingDelete(null);
      setNotice({ text: lang === 'bn' ? `${row.code} মুছে ফেলা হয়েছে` : `${row.code} deleted`, tone: 'ok' });
      router.refresh();
    } catch (error) {
      setPendingDelete(null);
      setNotice({ text: (error as Error).message, tone: 'error' });
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
          <table className="cpn-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'bn' ? 'কোড' : 'Code'}</th>
                <th scope="col">{lang === 'bn' ? 'ছাড়' : 'Discount'}</th>
                <th scope="col">{lang === 'bn' ? 'সময়' : 'Window'}</th>
                <th scope="col">{lang === 'bn' ? 'ব্যবহার' : 'Usage'}</th>
                <th scope="col">{lang === 'bn' ? 'অবস্থা' : 'State'}</th>
                <th scope="col">{lang === 'bn' ? 'কাজ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td data-label={lang === 'bn' ? 'কোড' : 'Code'}>
                    <b className="cpn-code">{row.code}</b>
                    <div className="cpn-sub">
                      {row.minOrderValuePoisha
                        ? `${lang === 'bn' ? 'সর্বনিম্ন' : 'min'} ${formatMoneyAdmin(row.minOrderValuePoisha)}`
                        : lang === 'bn'
                          ? 'সর্বনিম্ন নেই'
                          : 'no minimum'}
                    </div>
                  </td>
                  <td data-label={lang === 'bn' ? 'ছাড়' : 'Discount'}>{describeValue(row, lang)}</td>
                  <td data-label={lang === 'bn' ? 'সময়' : 'Window'}>
                    <div>{formatDate(row.startDate, lang)}</div>
                    <div className="cpn-sub">
                      {lang === 'bn' ? 'থেকে' : 'to'} {formatDate(row.endDate, lang)}
                    </div>
                  </td>
                  <td data-label={lang === 'bn' ? 'ব্যবহার' : 'Usage'}>
                    {row.usedCount}
                    {row.usageLimit !== null ? ` / ${row.usageLimit}` : ''}
                    <div className="cpn-sub">
                      {lang === 'bn' ? 'প্রতি ব্যবহারকারী' : 'per user'} {row.perUserLimit}
                    </div>
                  </td>
                  <td data-label={lang === 'bn' ? 'অবস্থা' : 'State'}>
                    <span className={`badge ${STATE_TONE[row.state] ?? 'mute'}`}>
                      {STATE_LABEL[row.state][lang]}
                    </span>
                  </td>
                  <td data-label={lang === 'bn' ? 'কাজ' : 'Actions'}>
                    <div className="cpn-actions">
                      <button type="button" className="btn ghost sm" onClick={() => open('edit', row.id)}>
                        <Pencil size={14} aria-hidden />
                        {lang === 'bn' ? 'সম্পাদনা' : 'Edit'}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => open('redeem', row.id)}>
                        <Users size={14} aria-hidden />
                        {lang === 'bn' ? 'রিপোর্ট' : 'Report'}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => void toggle(row)}>
                        {row.isActive
                          ? lang === 'bn'
                            ? 'বন্ধ'
                            : 'Deactivate'
                          : lang === 'bn'
                            ? 'চালু'
                            : 'Activate'}
                      </button>
                      {pendingDelete === row.id ? (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => void remove(row)}
                          >
                            {lang === 'bn' ? 'নিশ্চিত মুছুন' : 'Confirm delete'}
                          </button>
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => setPendingDelete(null)}
                          >
                            {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => setPendingDelete(row.id)}
                          aria-label={lang === 'bn' ? 'মুছুন' : 'Delete'}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prod-pager">
          <span>
            {lang === 'bn'
              ? `${total}টি · পৃষ্ঠা ${page}/${totalPages}`
              : `${total} total · page ${page} of ${totalPages}`}
          </span>
          <div>
            {prevHref ? (
              <a className="btn ghost sm" href={prevHref}>
                {lang === 'bn' ? 'আগের' : 'Previous'}
              </a>
            ) : null}
            {nextHref ? (
              <a className="btn ghost sm" href={nextHref}>
                {lang === 'bn' ? 'পরের' : 'Next'}
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {(openNew || editing) && (
        <CouponDrawer
          lang={lang}
          coupon={editing}
          onClose={close}
          onSaved={(message) => {
            setNotice({ text: message, tone: 'ok' });
            close();
            router.refresh();
          }}
        />
      )}

      {redeeming && (
        <RedemptionDrawer lang={lang} coupon={redeeming} onClose={close} />
      )}
    </>
  );
}

// ─── Create / edit drawer ───────────────────────────────────────────────────

interface DrawerProps {
  lang: Lang;
  coupon: CouponListItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function CouponDrawer({ lang, coupon, onClose, onSaved }: DrawerProps) {
  const [code, setCode] = useState(coupon?.code ?? '');
  const [type, setType] = useState<CouponType>(coupon?.type ?? 'FIXED');
  const [value, setValue] = useState(
    coupon ? (coupon.type === 'PERCENTAGE' ? String(coupon.value) : String(toTaka(coupon.value))) : '500',
  );
  const [minOrder, setMinOrder] = useState(
    coupon?.minOrderValuePoisha ? String(toTaka(coupon.minOrderValuePoisha)) : '',
  );
  const [maxDiscount, setMaxDiscount] = useState(
    coupon?.maxDiscountPoisha ? String(toTaka(coupon.maxDiscountPoisha)) : '',
  );
  const [usageLimit, setUsageLimit] = useState(coupon?.usageLimit ? String(coupon.usageLimit) : '');
  const [perUserLimit, setPerUserLimit] = useState(String(coupon?.perUserLimit ?? 1));
  const [startDate, setStartDate] = useState(
    (coupon?.startDate ?? new Date().toISOString()).slice(0, 10),
  );
  const [endDate, setEndDate] = useState(
    (coupon?.endDate ?? new Date(Date.now() + 30 * 86_400_000).toISOString()).slice(0, 10),
  );
  const [isActive, setIsActive] = useState(coupon?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);

    const body: CouponWriteBody = {
      code: code.trim().toUpperCase(),
      type,
      value: type === 'PERCENTAGE' ? Number(value) : toPoisha(Number(value) || 0),
      minOrderValuePoisha: minOrder ? toPoisha(Number(minOrder)) : null,
      maxDiscountPoisha: maxDiscount ? toPoisha(Number(maxDiscount)) : null,
      usageLimit: usageLimit ? Number(usageLimit) : null,
      perUserLimit: Number(perUserLimit) || 1,
      startDate: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
      endDate: new Date(`${endDate}T23:59:59.000Z`).toISOString(),
      isActive,
    };

    try {
      if (coupon) {
        await updateCoupon(coupon.id, body);
        onSaved(lang === 'bn' ? `${body.code} সংরক্ষিত` : `${body.code} saved`);
      } else {
        await createCoupon(body);
        onSaved(lang === 'bn' ? `${body.code} তৈরি হয়েছে` : `${body.code} created`);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer cpn-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={coupon ? 'Edit coupon' : 'New coupon'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>{coupon ? (lang === 'bn' ? 'কুপন সম্পাদনা' : 'Edit coupon') : lang === 'bn' ? 'নতুন কুপন' : 'New coupon'}</h2>
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

          <label className="field">
            <span>{lang === 'bn' ? 'কোড' : 'Code'}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="EID2026"
              maxLength={32}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'ধরন' : 'Type'}</span>
              <select value={type} onChange={(event) => setType(event.target.value as CouponType)}>
                <option value="FIXED">{TYPE_LABEL.FIXED[lang]}</option>
                <option value="PERCENTAGE">{TYPE_LABEL.PERCENTAGE[lang]}</option>
                <option value="FREE_DELIVERY">{TYPE_LABEL.FREE_DELIVERY[lang]}</option>
              </select>
            </label>

            {type !== 'FREE_DELIVERY' && (
              <label className="field">
                <span>
                  {type === 'PERCENTAGE'
                    ? lang === 'bn'
                      ? 'শতাংশ'
                      : 'Percent'
                    : lang === 'bn'
                      ? 'টাকা'
                      : 'Amount (৳)'}
                </span>
                <input
                  type="number"
                  min={type === 'PERCENTAGE' ? 1 : 1}
                  max={type === 'PERCENTAGE' ? 100 : undefined}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
            )}
          </div>

          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'সর্বনিম্ন অর্ডার (৳)' : 'Min order (৳)'}</span>
              <input
                type="number"
                min={0}
                value={minOrder}
                onChange={(event) => setMinOrder(event.target.value)}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>{lang === 'bn' ? 'সর্বোচ্চ ছাড় (৳)' : 'Max discount (৳)'}</span>
              <input
                type="number"
                min={0}
                value={maxDiscount}
                onChange={(event) => setMaxDiscount(event.target.value)}
                placeholder="—"
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'মোট ব্যবহার' : 'Total uses'}</span>
              <input
                type="number"
                min={1}
                value={usageLimit}
                onChange={(event) => setUsageLimit(event.target.value)}
                placeholder="∞"
              />
            </label>
            <label className="field">
              <span>{lang === 'bn' ? 'প্রতি ব্যবহারকারী' : 'Per user'}</span>
              <input
                type="number"
                min={1}
                value={perUserLimit}
                onChange={(event) => setPerUserLimit(event.target.value)}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'শুরু' : 'Starts'}</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="field">
              <span>{lang === 'bn' ? 'শেষ' : 'Ends'}</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>

          <label className="cpn-switch">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            <span>{lang === 'bn' ? 'সক্রিয়' : 'Active'}</span>
          </label>

          <p className="cpn-hint">
            {lang === 'bn'
              ? 'কুপন শুধু এই সময়ের ভেতরে কাজ করবে। ব্যবহারের সীমা শেষ হলে নিজে থেকেই বন্ধ হবে।'
              : 'The coupon only works inside this window. It stops on its own once the usage cap is reached.'}
          </p>
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            {lang === 'bn' ? 'বাতিল' : 'Cancel'}
          </button>
          <button type="button" className="btn" onClick={() => void save()} disabled={saving || code.trim().length < 3}>
            {saving ? (lang === 'bn' ? 'সংরক্ষণ…' : 'Saving…') : lang === 'bn' ? 'সংরক্ষণ' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Redemption report ──────────────────────────────────────────────────────

function RedemptionDrawer({
  lang,
  coupon,
  onClose,
}: {
  lang: Lang;
  coupon: CouponListItem;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CouponRedemption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRedemptions(coupon.id)
      .then((data) => {
        if (!cancelled) setRows(data.items);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [coupon.id]);

  const totalGiven = coupon.redemptionTotalPoisha;

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer cpn-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Redemptions"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>
            {coupon.code} · {lang === 'bn' ? 'ব্যবহারের রিপোর্ট' : 'Redemptions'}
          </h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="drawer-body">
          <div className="cpn-stats">
            <div>
              <span>{lang === 'bn' ? 'মোট ব্যবহার' : 'Redemptions'}</span>
              <b>{coupon.usedCount}</b>
            </div>
            <div>
              <span>{lang === 'bn' ? 'মোট ছাড় দেওয়া' : 'Discount given'}</span>
              <b>{formatMoneyAdmin(totalGiven)}</b>
            </div>
          </div>

          {error && (
            <div className="ord-notice is-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {rows === null && !error ? (
            <p className="cpn-hint">{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</p>
          ) : rows && rows.length === 0 ? (
            <p className="cpn-hint">
              {lang === 'bn' ? 'এখনো কেউ ব্যবহার করেনি।' : 'Nobody has used this yet.'}
            </p>
          ) : (
            <table className="cpn-table cpn-report">
              <thead>
                <tr>
                  <th scope="col">{lang === 'bn' ? 'অর্ডার' : 'Order'}</th>
                  <th scope="col">{lang === 'bn' ? 'ক্রেতা' : 'Customer'}</th>
                  <th scope="col">{lang === 'bn' ? 'ছাড়' : 'Discount'}</th>
                  <th scope="col">{lang === 'bn' ? 'তারিখ' : 'Date'}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((row) => (
                  <tr key={row.id}>
                    <td data-label={lang === 'bn' ? 'অর্ডার' : 'Order'}>{row.orderNumber ?? '—'}</td>
                    <td data-label={lang === 'bn' ? 'ক্রেতা' : 'Customer'}>{row.userName}</td>
                    <td data-label={lang === 'bn' ? 'ছাড়' : 'Discount'}>
                      {formatMoneyAdmin(row.amountPoisha)}
                    </td>
                    <td data-label={lang === 'bn' ? 'তারিখ' : 'Date'}>
                      {formatDate(row.createdAt, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
