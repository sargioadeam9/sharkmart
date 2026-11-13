'use client';

/**
 * Suppliers — the client island for `/admin/suppliers`.
 *
 * One overlay (the supplier), with purchase orders expanded inline inside it. A
 * second nested drawer would stack overlays and trap focus twice for what is
 * really "look at this order".
 *
 * Receiving asks for a quantity per line and sends a **delta**. The API clamps it
 * and refuses an over-receipt as a whole; the form mirrors that by disabling the
 * button when any entered amount exceeds what is outstanding, so the operator
 * gets the error before the round trip.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react';

import { formatMoneyAdmin, toPoisha, toTaka } from '@/lib/format';
import {
  addSupplierProduct,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  getSupplier,
  markOrderOrdered,
  receivePurchaseOrder,
  removeSupplierProduct,
  setSupplierActive,
  updateSupplier,
  type PoStatus,
  type PurchaseOrder,
  type SupplierDetail,
  type SupplierItem,
  type SupplierSort,
} from '@/lib/api/admin-suppliers';

type Lang = 'en' | 'bn';

const PO_TONE: Record<PoStatus, string> = {
  DRAFT: 'mute',
  ORDERED: 'info',
  PARTIAL: 'warn',
  RECEIVED: 'ok',
  CANCELLED: 'bad',
};

const PO_LABEL: Record<PoStatus, { en: string; bn: string }> = {
  DRAFT: { en: 'Draft', bn: 'খসড়া' },
  ORDERED: { en: 'Ordered', bn: 'অর্ডার করা' },
  PARTIAL: { en: 'Partial', bn: 'আংশিক' },
  RECEIVED: { en: 'Received', bn: 'প্রাপ্ত' },
  CANCELLED: { en: 'Cancelled', bn: 'বাতিল' },
};

function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Toolbar ────────────────────────────────────────────────────────────────

interface ToolbarProps {
  lang: Lang;
  initialQuery: string;
  active: string;
  sort: SupplierSort;
}

export function SuppliersToolbar({ lang, initialQuery, active, sort }: ToolbarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function build(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams();
    if (active !== 'all') next.set('active', active);
    if (sort !== 'newest') next.set('sort', sort);
    const q = overrides.q ?? initialQuery;
    if (q) next.set('q', q);
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'q') continue;
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/suppliers?${next.toString()}`;
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
          placeholder={lang === 'bn' ? 'নাম, ফোন বা যোগাযোগ' : 'Name, phone or contact'}
          aria-label={lang === 'bn' ? 'সরবরাহকারী খুঁজুন' : 'Search suppliers'}
        />
      </div>

      <div className="prod-filters">
        <select
          value={active}
          onChange={(event) => router.push(build({ active: event.target.value }))}
          aria-label={lang === 'bn' ? 'সক্রিয়' : 'Active'}
        >
          <option value="all">{lang === 'bn' ? 'সব' : 'All'}</option>
          <option value="true">{lang === 'bn' ? 'সক্রিয়' : 'Active'}</option>
          <option value="false">{lang === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive'}</option>
        </select>

        <select
          value={sort}
          onChange={(event) => router.push(build({ sort: event.target.value }))}
          aria-label={lang === 'bn' ? 'সাজান' : 'Sort'}
        >
          <option value="newest">{lang === 'bn' ? 'নতুন আগে' : 'Newest first'}</option>
          <option value="name">{lang === 'bn' ? 'নাম অনুসারে' : 'By name'}</option>
        </select>

        <button type="button" className="btn" onClick={() => router.push(build({ new: '1' }))}>
          <Plus size={16} aria-hidden />
          {lang === 'bn' ? 'নতুন সরবরাহকারী' : 'New supplier'}
        </button>
      </div>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: SupplierItem[];
  total: number;
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  queryString: string;
  openNew: boolean;
  openId: string | null;
}

export function SuppliersTable({
  lang,
  items,
  total,
  page,
  totalPages,
  prevHref,
  nextHref,
  queryString,
  openNew,
  openId,
}: TableProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  function close(): void {
    const next = new URLSearchParams(queryString);
    next.delete('new');
    next.delete('open');
    router.push(`/admin/suppliers?${next.toString()}`);
  }

  function open(id: string): void {
    const next = new URLSearchParams(queryString);
    next.delete('new');
    next.set('open', id);
    router.push(`/admin/suppliers?${next.toString()}`);
  }

  async function toggle(row: SupplierItem): Promise<void> {
    try {
      await setSupplierActive(row.id, !row.isActive);
      setNotice({
        text:
          lang === 'bn'
            ? `${row.name} ${row.isActive ? 'নিষ্ক্রিয়' : 'সক্রিয়'} করা হয়েছে`
            : `${row.name} is now ${row.isActive ? 'inactive' : 'active'}`,
        tone: 'ok',
      });
      router.refresh();
    } catch (error) {
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
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'bn' ? 'নাম' : 'Supplier'}</th>
                <th scope="col">{lang === 'bn' ? 'যোগাযোগ' : 'Contact'}</th>
                <th scope="col">{lang === 'bn' ? 'পণ্য' : 'Products'}</th>
                <th scope="col">{lang === 'bn' ? 'অর্ডার' : 'Orders'}</th>
                <th scope="col">{lang === 'bn' ? 'অবস্থা' : 'State'}</th>
                <th scope="col">{lang === 'bn' ? 'কাজ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td data-label={lang === 'bn' ? 'নাম' : 'Supplier'}>
                    <b>{row.name}</b>
                    {row.contactPerson && <div className="cpn-sub">{row.contactPerson}</div>}
                  </td>
                  <td data-label={lang === 'bn' ? 'যোগাযোগ' : 'Contact'}>
                    {row.phone}
                    {row.email && <div className="cpn-sub">{row.email}</div>}
                  </td>
                  <td data-label={lang === 'bn' ? 'পণ্য' : 'Products'}>{row.productCount}</td>
                  <td data-label={lang === 'bn' ? 'অর্ডার' : 'Orders'}>{row.orderCount}</td>
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
                      <button type="button" className="btn ghost sm" onClick={() => open(row.id)}>
                        {lang === 'bn' ? 'বিস্তারিত' : 'Open'}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => void toggle(row)}>
                        {row.isActive ? (lang === 'bn' ? 'বন্ধ' : 'Deactivate') : lang === 'bn' ? 'চালু' : 'Activate'}
                      </button>
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

      {(openNew || openId) && (
        <SupplierDrawer
          lang={lang}
          supplierId={openId}
          onClose={close}
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}

// ─── Supplier drawer ────────────────────────────────────────────────────────

function SupplierDrawer({
  lang,
  supplierId,
  onClose,
  onChanged,
}: {
  lang: Lang;
  supplierId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(supplierId));
  const [error, setError] = useState<string | null>(null);

  // create form
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supplierId) return;
    let cancelled = false;
    setLoading(true);
    getSupplier(supplierId)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setName(data.name);
          setContactPerson(data.contactPerson ?? '');
          setPhone(data.phone);
          setEmail(data.email ?? '');
          setAddress(data.address ?? '');
        }
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  async function reload(): Promise<void> {
    if (!supplierId) return;
    setDetail(await getSupplier(supplierId));
    onChanged();
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      if (supplierId) {
        await updateSupplier(supplierId, {
          name: name.trim(),
          contactPerson: contactPerson.trim() || null,
          phone: phone.trim(),
          email: email.trim() || null,
          address: address.trim() || null,
        });
        await reload();
      } else {
        await createSupplier({
          name: name.trim(),
          contactPerson: contactPerson.trim() || null,
          phone: phone.trim(),
          email: email.trim() || null,
          address: address.trim() || null,
        });
        onChanged();
        onClose();
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const valid = name.trim().length > 0 && phone.trim().length >= 6;

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer cpn-drawer sup-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={supplierId ? 'Supplier' : 'New supplier'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>
            {supplierId
              ? (detail?.name ?? (lang === 'bn' ? 'সরবরাহকারী' : 'Supplier'))
              : lang === 'bn'
                ? 'নতুন সরবরাহকারী'
                : 'New supplier'}
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

          {loading ? (
            <p className="cpn-hint">{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</p>
          ) : (
            <>
              <label className="field">
                <span>{lang === 'bn' ? 'নাম' : 'Name'}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>{lang === 'bn' ? 'যোগাযোগ ব্যক্তি' : 'Contact person'}</span>
                  <input
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="field">
                  <span>{lang === 'bn' ? 'ফোন' : 'Phone'}</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>{lang === 'bn' ? 'ইমেইল' : 'Email'}</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
                </label>
                <label className="field">
                  <span>{lang === 'bn' ? 'ঠিকানা' : 'Address'}</span>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={400} />
                </label>
              </div>

              <div className="sup-actions">
                <button type="button" className="btn sm" onClick={() => void save()} disabled={saving || !valid}>
                  {saving
                    ? lang === 'bn'
                      ? 'সংরক্ষণ…'
                      : 'Saving…'
                    : supplierId
                      ? lang === 'bn'
                        ? 'পরিবর্তন সংরক্ষণ'
                        : 'Save changes'
                      : lang === 'bn'
                        ? 'তৈরি করুন'
                        : 'Create'}
                </button>
              </div>

              {detail && (
                <>
                  <SuppliedProducts lang={lang} supplier={detail} onChanged={reload} />
                  <SupplierOrders lang={lang} supplier={detail} onChanged={reload} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Supplied products ──────────────────────────────────────────────────────

function SuppliedProducts({
  lang,
  supplier,
  onChanged,
}: {
  lang: Lang;
  supplier: SupplierDetail;
  onChanged: () => Promise<void>;
}) {
  const [productId, setProductId] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await addSupplierProduct(supplier.id, {
        productId,
        costPricePoisha: toPoisha(Number(cost) || 0),
      });
      setProductId('');
      setCost('');
      await onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await removeSupplierProduct(supplier.id, id);
      await onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <section className="sup-section">
      <h3>{lang === 'bn' ? 'এই সরবরাহকারীর পণ্য' : 'Products from this supplier'}</h3>

      {error && (
        <div className="ord-notice is-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {supplier.products.length === 0 ? (
        <p className="cpn-hint">
          {lang === 'bn' ? 'এখনো কোনো পণ্য যোগ করা হয়নি।' : 'No products linked yet.'}
        </p>
      ) : (
        <ul className="sup-list">
          {supplier.products.map((product) => (
            <li key={product.productId}>
              <div>
                <b>{product.nameEn}</b>
                <div className="cpn-sub">{product.sku}</div>
              </div>
              <div className="sup-list-right">
                <span>{formatMoneyAdmin(product.costPricePoisha)}</span>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => void remove(product.productId)}
                  aria-label={lang === 'bn' ? 'সরান' : 'Remove'}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="field-row sup-add">
        <label className="field">
          <span>{lang === 'bn' ? 'পণ্য আইডি' : 'Product id'}</span>
          <input
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            placeholder="uuid"
          />
        </label>
        <label className="field">
          <span>{lang === 'bn' ? 'ক্রয়মূল্য (৳)' : 'Cost (৳)'}</span>
          <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn ghost sm"
        onClick={() => void add()}
        disabled={busy || productId.length < 8 || !cost}
      >
        <Plus size={14} aria-hidden />
        {lang === 'bn' ? 'পণ্য যোগ করুন' : 'Link product'}
      </button>
    </section>
  );
}

// ─── Purchase orders ────────────────────────────────────────────────────────

function SupplierOrders({
  lang,
  supplier,
  onChanged,
}: {
  lang: Lang;
  supplier: SupplierDetail;
  onChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);

  // new order form
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [cost, setCost] = useState('');

  async function toggle(id: string): Promise<void> {
    if (expanded === id) {
      setExpanded(null);
      setOrder(null);
      return;
    }
    setExpanded(id);
    setReceipt({});
    setNote('');
    setError(null);
    try {
      setOrder(await getPurchaseOrder(id));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function act(action: 'order' | 'receive' | 'cancel'): Promise<void> {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'order') {
        setOrder(await markOrderOrdered(order.id));
      } else if (action === 'cancel') {
        setOrder(await cancelPurchaseOrder(order.id, 'Cancelled from the supplier screen'));
      } else {
        const lines = Object.entries(receipt)
          .map(([itemId, value]) => ({ itemId, receivedQuantity: Number(value) || 0 }))
          .filter((line) => line.receivedQuantity > 0);
        if (lines.length === 0) {
          setError(lang === 'bn' ? 'কোনো পরিমাণ দেওয়া হয়নি।' : 'Enter a quantity first.');
          return;
        }
        setOrder(await receivePurchaseOrder(order.id, lines, note.trim() || undefined));
        setReceipt({});
        setNote('');
      }
      await onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await createPurchaseOrder({
        supplierId: supplier.id,
        items: [
          {
            productId,
            quantity: Number(quantity) || 0,
            costPricePoisha: toPoisha(Number(cost) || 0),
          },
        ],
      });
      setProductId('');
      setCost('');
      setCreating(false);
      await onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const overReceipt = useMemo(() => {
    if (!order) return false;
    return Object.entries(receipt).some(([itemId, value]) => {
      const item = order.items.find((entry) => entry.id === itemId);
      if (!item) return false;
      return Number(value) > item.quantity - item.receivedQuantity;
    });
  }, [order, receipt]);

  return (
    <section className="sup-section">
      <div className="sup-section-head">
        <h3>{lang === 'bn' ? 'ক্রয় অর্ডার' : 'Purchase orders'}</h3>
        <button type="button" className="btn ghost sm" onClick={() => setCreating((v) => !v)}>
          <Plus size={14} aria-hidden />
          {lang === 'bn' ? 'নতুন' : 'New'}
        </button>
      </div>

      {error && (
        <div className="ord-notice is-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {creating && (
        <div className="sup-new-po">
          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'পণ্য আইডি' : 'Product id'}</span>
              <input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="uuid" />
            </label>
            <label className="field">
              <span>{lang === 'bn' ? 'পরিমাণ' : 'Quantity'}</span>
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'একক দাম (৳)' : 'Unit cost (৳)'}</span>
              <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
            </label>
            <div className="field sup-new-po-submit">
              <button
                type="button"
                className="btn sm"
                onClick={() => void create()}
                disabled={busy || productId.length < 8 || !cost}
              >
                {lang === 'bn' ? 'খসড়া তৈরি' : 'Create draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {supplier.orders.length === 0 ? (
        <p className="cpn-hint">
          {lang === 'bn' ? 'কোনো ক্রয় অর্ডার নেই।' : 'No purchase orders yet.'}
        </p>
      ) : (
        <ul className="sup-orders">
          {supplier.orders.map((row) => (
            <li key={row.id}>
              <button type="button" className="sup-order-row" onClick={() => void toggle(row.id)}>
                <ChevronDown
                  size={14}
                  aria-hidden
                  style={{ transform: expanded === row.id ? 'rotate(180deg)' : undefined }}
                />
                <span className={`badge ${PO_TONE[row.status]}`}>{PO_LABEL[row.status][lang]}</span>
                <span>{formatDate(row.createdAt, lang)}</span>
                <b>{formatMoneyAdmin(row.totalAmountPoisha)}</b>
              </button>

              {expanded === row.id && order && (
                <div className="sup-order-body">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th scope="col">{lang === 'bn' ? 'পণ্য' : 'Product'}</th>
                        <th scope="col">{lang === 'bn' ? 'অর্ডার' : 'Ordered'}</th>
                        <th scope="col">{lang === 'bn' ? 'প্রাপ্ত' : 'Received'}</th>
                        <th scope="col">{lang === 'bn' ? 'এখন প্রাপ্ত' : 'Receive now'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => (
                        <tr key={item.id}>
                          <td data-label={lang === 'bn' ? 'পণ্য' : 'Product'}>
                            {item.productName}
                            <div className="cpn-sub">{item.sku}</div>
                          </td>
                          <td data-label={lang === 'bn' ? 'অর্ডার' : 'Ordered'}>{item.quantity}</td>
                          <td data-label={lang === 'bn' ? 'প্রাপ্ত' : 'Received'}>
                            {item.receivedQuantity}
                          </td>
                          <td data-label={lang === 'bn' ? 'এখন প্রাপ্ত' : 'Receive now'}>
                            <input
                              type="number"
                              min={0}
                              max={item.quantity - item.receivedQuantity}
                              value={receipt[item.id] ?? ''}
                              disabled={order.status === 'RECEIVED' || order.status === 'CANCELLED'}
                              onChange={(event) =>
                                setReceipt((prev) => ({ ...prev, [item.id]: event.target.value }))
                              }
                              className="sup-receive-input"
                              aria-label={`${item.productName} receive quantity`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <label className="field">
                    <span>{lang === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Note (optional)'}</span>
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={
                        lang === 'bn' ? 'স্বল্পতা বা মন্তব্য' : 'Shortage or remark'
                      }
                    />
                  </label>

                  <div className="sup-order-actions">
                    {order.status === 'DRAFT' && (
                      <button type="button" className="btn sm" onClick={() => void act('order')} disabled={busy}>
                        {lang === 'bn' ? 'সরবরাহকারীকে পাঠান' : 'Send to supplier'}
                      </button>
                    )}

                    {(order.status === 'ORDERED' || order.status === 'PARTIAL') && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => void act('receive')}
                        disabled={busy || overReceipt}
                      >
                        {lang === 'bn' ? 'স্টক গ্রহণ' : 'Receive stock'}
                      </button>
                    )}

                    {(order.status === 'DRAFT' || order.status === 'ORDERED' || order.status === 'PARTIAL') && (
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => void act('cancel')}
                        disabled={busy}
                      >
                        {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                      </button>
                    )}
                  </div>

                  {overReceipt && (
                    <p className="cpn-hint" style={{ color: 'var(--bad)' }}>
                      {lang === 'bn'
                        ? 'একটা লাইনে অর্ডারের বেশি দেওয়া হয়েছে।'
                        : 'One line is more than what is still outstanding.'}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
