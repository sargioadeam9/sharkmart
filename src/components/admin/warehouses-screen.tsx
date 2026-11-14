'use client';

/**
 * Warehouses — the client island for `/admin/warehouses`.
 *
 * Two things live here: the warehouse list with its per-location stock, and the
 * transfer form. The transfer posts a delta between two warehouses and the API
 * does the move in one transaction; this screen only collects the four inputs.
 *
 * The stock table shows `WarehouseStock`, which for a **variant** product is an
 * allocation record rather than the availability figure — availability for those
 * lives on the variant. That is stated in the drawer so nobody reads the number
 * as "how many do we have".
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Plus, Star, X } from 'lucide-react';

import {
  createTransfer,
  createWarehouse,
  getWarehouseStock,
  setDefaultWarehouse,
  updateWarehouse,
  type StockResponse,
  type TransferItem,
  type WarehouseItem,
} from '@/lib/api/admin-warehouses';

type Lang = 'en' | 'bn';

export function WarehousesScreen({
  lang,
  warehouses,
  transfers,
}: {
  lang: Lang;
  warehouses: WarehouseItem[];
  transfers: TransferItem[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const open = warehouses.find((row) => row.id === openId) ?? null;

  async function makeDefault(id: string): Promise<void> {
    try {
      await setDefaultWarehouse(id);
      setNotice({ text: lang === 'bn' ? 'ডিফল্ট বদলানো হয়েছে' : 'Default warehouse changed', tone: 'ok' });
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

      <div className="prod-toolbar ord-toolbar">
        <div className="prod-search">
          <span className="cpn-hint">
            {lang === 'bn'
              ? 'স্টক এখন যেখানে আছে, সেটাই এখানে দেখা যায়।'
              : 'Where stock sits right now.'}
          </span>
        </div>
        <div className="prod-filters">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            {lang === 'bn' ? 'নতুন গুদাম' : 'New warehouse'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'bn' ? 'গুদাম' : 'Warehouse'}</th>
                <th scope="col">{lang === 'bn' ? 'ঠিকানা' : 'Address'}</th>
                <th scope="col">{lang === 'bn' ? 'পণ্য' : 'Products'}</th>
                <th scope="col">{lang === 'bn' ? 'ইউনিট' : 'Units'}</th>
                <th scope="col">{lang === 'bn' ? 'অবস্থা' : 'State'}</th>
                <th scope="col">{lang === 'bn' ? 'কাজ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((row) => (
                <tr key={row.id}>
                  <td data-label={lang === 'bn' ? 'গুদাম' : 'Warehouse'}>
                    <b>{row.name}</b>
                    {row.isDefault && (
                      <div className="cpn-sub">
                        {lang === 'bn' ? 'ডিফল্ট · স্টক গ্রহণ এখানেই যায়' : 'Default · receiving lands here'}
                      </div>
                    )}
                  </td>
                  <td data-label={lang === 'bn' ? 'ঠিকানা' : 'Address'}>{row.address ?? '—'}</td>
                  <td data-label={lang === 'bn' ? 'পণ্য' : 'Products'}>{row.productCount}</td>
                  <td data-label={lang === 'bn' ? 'ইউনিট' : 'Units'}>{row.totalUnits}</td>
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
                      <button type="button" className="btn ghost sm" onClick={() => setOpenId(row.id)}>
                        {lang === 'bn' ? 'স্টক দেখুন' : 'View stock'}
                      </button>
                      {!row.isDefault && row.isActive && (
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => void makeDefault(row.id)}
                        >
                          <Star size={13} aria-hidden />
                          {lang === 'bn' ? 'ডিফল্ট করুন' : 'Make default'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="card sup-section" style={{ marginTop: 18 }}>
        <h3>{lang === 'bn' ? 'সাম্প্রতিক ট্রান্সফার' : 'Recent transfers'}</h3>
        {transfers.length === 0 ? (
          <p className="cpn-hint">
            {lang === 'bn' ? 'কোনো ট্রান্সফার নেই।' : 'No transfers yet.'}
          </p>
        ) : (
          <ul className="sup-orders">
            {transfers.map((row) => (
              <li key={row.id}>
                <div className="sup-order-row" style={{ cursor: 'default' }}>
                  <span className={`badge ${row.status === 'COMPLETED' ? 'ok' : 'warn'}`}>{row.status}</span>
                  <span>{row.productName}</span>
                  <ArrowRight size={13} aria-hidden />
                  <span>
                    {row.fromName} → {row.toName}
                  </span>
                  <b>{row.quantity}</b>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(open || creating) && (
        <WarehouseDrawer
          lang={lang}
          warehouse={open}
          warehouses={warehouses}
          onClose={() => {
            setOpenId(null);
            setCreating(false);
          }}
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}

function WarehouseDrawer({
  lang,
  warehouse,
  warehouses,
  onClose,
  onChanged,
}: {
  lang: Lang;
  warehouse: WarehouseItem | null;
  warehouses: WarehouseItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(warehouse?.name ?? '');
  const [address, setAddress] = useState(warehouse?.address ?? '');
  const [isActive, setIsActive] = useState(warehouse?.isActive ?? true);
  const [stock, setStock] = useState<StockResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // transfer form
  const [toId, setToId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');

  useEffect(() => {
    if (!warehouse) return;
    let cancelled = false;
    getWarehouseStock(warehouse.id)
      .then((data) => {
        if (!cancelled) setStock(data);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouse]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (warehouse) {
        await updateWarehouse(warehouse.id, {
          name: name.trim(),
          address: address.trim() || null,
          isActive,
        });
      } else {
        await createWarehouse({ name: name.trim(), address: address.trim() || null });
      }
      onChanged();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function transfer(): Promise<void> {
    if (!warehouse) return;
    setBusy(true);
    setError(null);
    try {
      await createTransfer({
        fromWarehouseId: warehouse.id,
        toWarehouseId: toId,
        productId,
        quantity: Number(quantity) || 0,
      });
      setProductId('');
      setQuantity('1');
      const fresh = await getWarehouseStock(warehouse.id);
      setStock(fresh);
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer cpn-drawer sup-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={warehouse ? 'Warehouse' : 'New warehouse'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>
            {warehouse
              ? warehouse.name
              : lang === 'bn'
                ? 'নতুন গুদাম'
                : 'New warehouse'}
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

          <label className="field">
            <span>{lang === 'bn' ? 'নাম' : 'Name'}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>

          <label className="field">
            <span>{lang === 'bn' ? 'ঠিকানা' : 'Address'}</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={400} />
          </label>

          {warehouse && (
            <label className="cpn-switch">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              <span>{lang === 'bn' ? 'সক্রিয়' : 'Active'}</span>
            </label>
          )}

          {warehouse && (
            <>
              <section className="sup-section">
                <h3>{lang === 'bn' ? 'এই গুদামের স্টক' : 'Stock in this warehouse'}</h3>
                <p className="cpn-hint">
                  {lang === 'bn'
                    ? 'ভ্যারিয়েন্ট থাকা পণ্যের আসল স্টক ভ্যারিয়েন্টে থাকে; এখানে অবস্থানভিত্তিক বরাদ্দ দেখা যায়।'
                    : 'For a product with variants, availability lives on the variant — this table shows the allocation.'}
                </p>

                {!stock ? (
                  <p className="cpn-hint">{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</p>
                ) : stock.items.length === 0 ? (
                  <p className="cpn-hint">
                    {lang === 'bn' ? 'এই গুদাম খালি।' : 'This warehouse is empty.'}
                  </p>
                ) : (
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th scope="col">{lang === 'bn' ? 'পণ্য' : 'Product'}</th>
                        <th scope="col">{lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variant'}</th>
                        <th scope="col">{lang === 'bn' ? 'পরিমাণ' : 'Qty'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.items.slice(0, 10).map((row) => (
                        <tr key={row.id}>
                          <td data-label={lang === 'bn' ? 'পণ্য' : 'Product'}>
                            {row.productName}
                            <div className="cpn-sub">{row.sku}</div>
                          </td>
                          <td data-label={lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variant'}>
                            {row.variantName ?? '—'}
                          </td>
                          <td data-label={lang === 'bn' ? 'পরিমাণ' : 'Qty'}>{row.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="sup-section">
                <h3>{lang === 'bn' ? 'অন্য গুদামে সরান' : 'Transfer to another warehouse'}</h3>

                <label className="field">
                  <span>{lang === 'bn' ? 'গন্তব্য' : 'Destination'}</span>
                  <select value={toId} onChange={(event) => setToId(event.target.value)}>
                    <option value="">{lang === 'bn' ? 'বেছে নিন' : 'Choose'}</option>
                    {warehouses
                      .filter((row) => row.id !== warehouse.id && row.isActive)
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                  </select>
                </label>

                <div className="field-row">
                  <label className="field">
                    <span>{lang === 'bn' ? 'পণ্য আইডি' : 'Product id'}</span>
                    <input
                      value={productId}
                      onChange={(event) => setProductId(event.target.value)}
                      placeholder="uuid"
                    />
                  </label>
                  <label className="field">
                    <span>{lang === 'bn' ? 'পরিমাণ' : 'Quantity'}</span>
                    <input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => void transfer()}
                  disabled={busy || !toId || productId.length < 8 || Number(quantity) < 1}
                >
                  <ArrowRight size={14} aria-hidden />
                  {lang === 'bn' ? 'সরান' : 'Transfer'}
                </button>
              </section>
            </>
          )}
        </div>

        {/**
         * The save action belongs in a footer.
         *
         * It used to be the last item in the scrolling body, which on a new
         * warehouse — two fields and nothing else — stretched a disabled button
         * across the full width directly under the address, with a screen of
         * empty white below it. In edit mode it scrolled away above the stock
         * table.
         */}
        <div className="drawer-foot">
          <button
            type="button"
            className="btn"
            onClick={() => void save()}
            disabled={busy || name.trim().length === 0}
          >
            {warehouse
              ? lang === 'bn'
                ? 'সংরক্ষণ'
                : 'Save'
              : lang === 'bn'
                ? 'তৈরি করুন'
                : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
