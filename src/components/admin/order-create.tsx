'use client';

/**
 * "New order" — a phone order typed in by staff.
 *
 * ── Why the admin needs this at all ────────────────────────────────────────
 *
 * A large share of orders in this market arrive by phone or Facebook message,
 * and the shopkeeper takes them by hand. Without this, the only way to record one
 * is to place it on the storefront as a fake customer — which puts a bogus
 * address in the address book and an order in a stranger's history.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * It does not send a price. The lines are ids and quantities; `placeOrder`
 * derives the price, the delivery charge and the total from the database, the
 * same way it does for a customer. A staff form that could type a total would be
 * a form that can sell a ৳5,000 phone for ৳5 with an audit row saying a member of
 * staff did it.
 *
 * Product search reuses `/admin/pos/catalog`, which already answers "find me a
 * product by name or barcode" — the till and this drawer ask the same question.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, Search, Trash2, X } from 'lucide-react';

import { adminFetch } from '@/lib/api/admin-client';
import { formatMoneyAdmin } from '@/lib/format';
import { DIVISIONS, districtsOf } from '@/lib/geo';

type Lang = 'en' | 'bn';

interface CatalogItem {
  productId: string;
  nameEn: string;
  nameBn: string;
  sku: string;
  pricePoisha: number;
  hasVariants: boolean;
  stock: number | null;
  variants: Array<{ id: string; sku: string; nameEn: string; nameBn: string; pricePoisha: number; stock: number }>;
}

interface Line {
  key: string;
  productId: string;
  variantId: string | null;
  nameEn: string;
  nameBn: string;
  sku: string;
  unitPricePoisha: number;
  quantity: number;
}

const PAYMENT_METHODS = ['COD', 'BKASH', 'NAGAD', 'SSLCOMMERZ'] as const;

export function NewOrderButton({ lang, canWrite }: { lang: Lang; canWrite: boolean }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  /**
   * Slugs, not display names — `DIVISIONS[].value` is `'dhaka'`, and a select
   * whose `value` is `'Dhaka'` matches no option and renders blank while still
   * submitting. The first version of this form did exactly that.
   */
  const [division, setDivision] = useState('dhaka');
  const [district, setDistrict] = useState('dhaka');
  const [area, setArea] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('COD');
  const [deliveryMethod, setDeliveryMethod] = useState<'STANDARD' | 'EXPRESS'>('STANDARD');
  const [notes, setNotes] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const districts = districtsOf(division);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const query_string = query.trim() ? `?q=${encodeURIComponent(query.trim())}&limit=12` : '?limit=12';
        const response = await adminFetch<{ items: CatalogItem[] }>(`/admin/pos/catalog${query_string}`, {
          signal: controller.signal,
        });
        setResults(response.data.items);
      } catch {
        /* an aborted request is the next keystroke, not an error */
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  const addLine = useCallback((item: CatalogItem, variant: CatalogItem['variants'][number] | null) => {
    const key = `${item.productId}:${variant?.id ?? ''}`;
    setLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: Math.min(line.quantity + 1, 99) } : line,
        );
      }
      return [
        ...current,
        {
          key,
          productId: item.productId,
          variantId: variant?.id ?? null,
          nameEn: item.nameEn,
          nameBn: item.nameBn,
          sku: variant?.sku ?? item.sku,
          unitPricePoisha: variant?.pricePoisha ?? item.pricePoisha,
          quantity: 1,
        },
      ];
    });
    setQuery('');
  }, []);

  function reset(): void {
    setCustomerName('');
    setCustomerPhone('');
    setContactEmail('');
    setArea('');
    setAddressLine('');
    setPaymentMethod('COD');
    setDeliveryMethod('STANDARD');
    setNotes('');
    setLines([]);
    setQuery('');
    setResults([]);
    setError(null);
  }

  function close(): void {
    setOpen(false);
    reset();
  }

  const subtotal = lines.reduce((sum, line) => sum + line.unitPricePoisha * line.quantity, 0);

  const valid =
    customerName.trim().length >= 2 &&
    /^(?:\+?880|0)1[3-9]\d{8}$/.test(customerPhone.trim()) &&
    area.trim().length > 0 &&
    addressLine.trim().length >= 3 &&
    lines.length > 0;

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await adminFetch<{ orderNumber: string }>('/admin/orders', {
        method: 'POST',
        body: {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
          address: {
            division,
            district,
            area: area.trim(),
            address: addressLine.trim(),
          },
          items: lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
          paymentMethod,
          deliveryMethod,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });

      close();
      setNotice(
        lang === 'bn'
          ? `অর্ডার ${response.data.orderNumber} তৈরি হয়েছে।`
          : `Order ${response.data.orderNumber} created.`,
      );
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite) return null;

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden />
        {lang === 'bn' ? 'নতুন অর্ডার' : 'New order'}
      </button>

      {notice && (
        <div className="ord-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      {open && (
        <div className="overlay side open" onClick={close}>
          <div
            className="drawer cpn-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'bn' ? 'নতুন অর্ডার' : 'New order'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>{lang === 'bn' ? 'নতুন অর্ডার' : 'New order'}</h2>
              <button type="button" className="x" onClick={close} aria-label="Close">
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
                <span>{lang === 'bn' ? 'গ্রাহকের নাম' : 'Customer name'}</span>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>{lang === 'bn' ? 'মোবাইল' : 'Mobile'}</span>
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="01712345678"
                    inputMode="tel"
                    maxLength={20}
                  />
                </label>
                <label className="field">
                  <span>{lang === 'bn' ? 'ইমেইল (ঐচ্ছিক)' : 'Email (optional)'}</span>
                  <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={254} />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>{lang === 'bn' ? 'বিভাগ' : 'Division'}</span>
                  <select
                    value={division}
                    onChange={(e) => {
                      setDivision(e.target.value);
                      const next = districtsOf(e.target.value);
                      setDistrict(next[0]?.value ?? '');
                    }}
                  >
                    {DIVISIONS.map((row) => (
                      <option key={row.value} value={row.value}>
                        {lang === 'bn' ? row.bn : row.en}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{lang === 'bn' ? 'জেলা' : 'District'}</span>
                  <select value={district} onChange={(e) => setDistrict(e.target.value)}>
                    {districts.map((row) => (
                      <option key={row.value} value={row.value}>
                        {lang === 'bn' ? row.bn : row.en}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>{lang === 'bn' ? 'এলাকা / থানা' : 'Area / thana'}</span>
                  <input value={area} onChange={(e) => setArea(e.target.value)} maxLength={120} />
                </label>
                <label className="field">
                  <span>{lang === 'bn' ? 'ঠিকানা' : 'Address'}</span>
                  <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} maxLength={400} />
                </label>
              </div>

              {/* ── Items ─────────────────────────────────────────────── */}
              <div className="ord-items">
                <div className="pos-search">
                  <Search size={15} aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={lang === 'bn' ? 'পণ্য খুঁজুন বা বারকোড' : 'Find a product or scan'}
                    aria-label={lang === 'bn' ? 'পণ্য খুঁজুন' : 'Find a product'}
                  />
                </div>

                {results.length > 0 && (
                  <div className="ord-results">
                    {results.map((item) => (
                      <div key={item.productId} className="ord-result">
                        <span>{lang === 'bn' ? item.nameBn : item.nameEn}</span>
                        {item.hasVariants ? (
                          <span className="ord-variants">
                            {item.variants.map((variant) => (
                              <button
                                key={variant.id}
                                type="button"
                                className="btn ghost sm"
                                onClick={() => addLine(item, variant)}
                              >
                                {lang === 'bn' ? variant.nameBn : variant.nameEn}
                              </button>
                            ))}
                          </span>
                        ) : (
                          <button type="button" className="btn ghost sm" onClick={() => addLine(item, null)}>
                            {formatMoneyAdmin(item.pricePoisha)}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {lines.length === 0 ? (
                  <p className="cpn-hint">
                    {lang === 'bn' ? 'এখনো কোনো পণ্য যোগ করা হয়নি।' : 'No items yet.'}
                  </p>
                ) : (
                  lines.map((line) => (
                    <div className="ord-line" key={line.key}>
                      <div>
                        <strong>{lang === 'bn' ? line.nameBn : line.nameEn}</strong>
                        <span className="cpn-sub">{line.sku}</span>
                      </div>
                      <div className="ord-qty">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((current) =>
                              current
                                .map((row) =>
                                  row.key === line.key
                                    ? { ...row, quantity: Math.max(0, row.quantity - 1) }
                                    : row,
                                )
                                .filter((row) => row.quantity > 0),
                            )
                          }
                          aria-label="-"
                        >
                          <Minus size={13} aria-hidden />
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? { ...row, quantity: Math.min(99, row.quantity + 1) }
                                  : row,
                              ),
                            )
                          }
                          aria-label="+"
                        >
                          <Plus size={13} aria-hidden />
                        </button>
                      </div>
                      <span className="ord-amount">
                        {formatMoneyAdmin(line.unitPricePoisha * line.quantity)}
                      </span>
                      <button
                        type="button"
                        className="pos-line-remove"
                        onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                        aria-label="Remove"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  ))
                )}

                {lines.length > 0 && (
                  <p className="cpn-hint">
                    {lang === 'bn' ? 'সাবটোটাল' : 'Subtotal'}: <strong>{formatMoneyAdmin(subtotal)}</strong>
                    {' · '}
                    {lang === 'bn'
                      ? 'ডেলিভারি ও মোট চেকআউট নিয়মে হিসাব হবে।'
                      : 'delivery and total are computed by the checkout rules.'}
                  </p>
                )}
              </div>

              <div className="field-row">
                <label className="field">
                  <span>{lang === 'bn' ? 'পেমেন্ট' : 'Payment'}</span>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as (typeof PAYMENT_METHODS)[number])}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method === 'COD' ? (lang === 'bn' ? 'ক্যাশ অন ডেলিভারি' : 'Cash on delivery') : method}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{lang === 'bn' ? 'ডেলিভারি' : 'Delivery'}</span>
                  <select
                    value={deliveryMethod}
                    onChange={(e) => setDeliveryMethod(e.target.value as 'STANDARD' | 'EXPRESS')}
                  >
                    <option value="STANDARD">{lang === 'bn' ? 'স্ট্যান্ডার্ড' : 'Standard'}</option>
                    <option value="EXPRESS">{lang === 'bn' ? 'এক্সপ্রেস' : 'Express'}</option>
                  </select>
                </label>
              </div>

              <label className="field">
                <span>{lang === 'bn' ? 'নোট' : 'Note'}</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
              </label>
            </div>

            <div className="drawer-foot">
              <button type="button" className="btn ghost" onClick={close} disabled={busy}>
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button type="button" className="btn" onClick={() => void save()} disabled={busy || !valid}>
                {busy
                  ? lang === 'bn'
                    ? 'তৈরি হচ্ছে…'
                    : 'Creating…'
                  : lang === 'bn'
                    ? 'অর্ডার তৈরি করুন'
                    : 'Create order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
