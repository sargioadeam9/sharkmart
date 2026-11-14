'use client';

/**
 * The till — `/admin/pos`.
 *
 * ── What this screen is ────────────────────────────────────────────────────
 *
 * A counter, not a form. The cashier's loop is: scan or tap a product, take the
 * money, print. Everything here serves that loop and nothing else — there is no
 * order history table, no status dropdown, no courier field. Those live in
 * Orders, which is where a counter sale appears the moment it is rung up.
 *
 * ── The three states ───────────────────────────────────────────────────────
 *
 *   no shift   the start-of-day float. Sales are refused until it is open, so
 *              this is not a nag screen — it is the gate.
 *   selling    search on the left, basket and payment on the right.
 *   receipt    80mm paper, then "New sale".
 *
 * ── Why the basket is client state only ────────────────────────────────────
 *
 * A till basket is not a cart: there is one customer standing in front of you
 * and the transaction is over in ninety seconds. Persisting it would mean
 * deciding what to do with yesterday's abandoned basket, and the answer would
 * be "nothing", which is a feature nobody asked for. A refresh loses the
 * basket, which is the correct behaviour when the cashier refreshes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Banknote,
  CreditCard,
  Minus,
  Plus,
  Printer,
  Search,
  Smartphone,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';

import {
  closeShift,
  createSale,
  getCurrentSession,
  openShift,
  searchCatalog,
  type PosCatalogItem,
  type PosSale,
  type PosSession,
  type PosVariant,
} from '@/lib/api/admin-pos';
import { formatMoneyAdmin, toPoisha } from '@/lib/format';

type Lang = 'en' | 'bn';
type PaymentMethod = 'CASH' | 'CARD' | 'BKASH' | 'NAGAD';

interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  nameEn: string;
  nameBn: string;
  sku: string;
  unitPricePoisha: number;
  quantity: number;
  /** Available at add time. The server is the authority; this is a courtesy. */
  available: number;
}

/**
 * A uuid for the idempotency key.
 *
 * `crypto.randomUUID` is only available in a secure context, and a shop panel
 * reached over plain http on the LAN is not one. The fallback is deliberately
 * not random-looking-but-weak: it still uses `crypto.getRandomValues` where it
 * can, and only degrades to `Math.random` if there is no crypto object at all,
 * which would mean a browser old enough that the till has bigger problems.
 */
function newClientRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parses a taka input into poisha. Empty or junk is zero, never NaN. */
function takaToPoisha(value: string): number {
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? toPoisha(parsed) : 0;
}

const PAYMENT_METHODS: Array<{
  id: PaymentMethod;
  en: string;
  bn: string;
  icon: typeof Banknote;
}> = [
  { id: 'CASH', en: 'Cash', bn: 'নগদ', icon: Banknote },
  { id: 'CARD', en: 'Card', bn: 'কার্ড', icon: CreditCard },
  { id: 'BKASH', en: 'bKash', bn: 'বিকাশ', icon: Smartphone },
  { id: 'NAGAD', en: 'Nagad', bn: 'নগদ (Nagad)', icon: Smartphone },
];

export function PosScreen({
  lang,
  initialSession,
}: {
  lang: Lang;
  initialSession: PosSession | null;
}) {
  const router = useRouter();

  const [session, setSession] = useState<PosSession | null>(initialSession);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // Search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PosCatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Basket
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountTaka, setDiscountTaka] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashTaka, setCashTaka] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [clientRef, setClientRef] = useState(newClientRef);
  const [submitting, setSubmitting] = useState(false);

  // Receipt
  const [receipt, setReceipt] = useState<PosSale | null>(null);

  // Shift close
  const [closing, setClosing] = useState(false);

  const subtotalPoisha = cart.reduce((sum, line) => sum + line.unitPricePoisha * line.quantity, 0);
  const discountPoisha = Math.min(takaToPoisha(discountTaka), subtotalPoisha);
  const totalPoisha = subtotalPoisha - discountPoisha;
  const cashPoisha = takaToPoisha(cashTaka);
  const changePoisha = cashPoisha > totalPoisha ? cashPoisha - totalPoisha : 0;

  /** 50% of the bill — mirrors `MAX_MANUAL_DISCOUNT_PERCENT` on the server. */
  const discountCapPoisha = Math.floor(subtotalPoisha / 2);
  const discountTooLarge = discountPoisha > discountCapPoisha;

  const canSubmit =
    cart.length > 0 &&
    totalPoisha > 0 &&
    !discountTooLarge &&
    !submitting &&
    (paymentMethod !== 'CASH' || cashPoisha >= totalPoisha);

  // ─── Search ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!session) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchCatalog(query, controller.signal));
      } catch (error) {
        // An aborted request is not an error — it is the next keystroke.
        if ((error as Error).name !== 'AbortError') {
          setNotice({ text: (error as Error).message, tone: 'error' });
        }
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, session]);

  useEffect(() => {
    if (session && !receipt) searchRef.current?.focus();
  }, [session, receipt]);

  // ─── Basket ──────────────────────────────────────────────────────────────

  const addLine = useCallback(
    (item: PosCatalogItem, variant: PosVariant | null) => {
      const unitPricePoisha = variant ? variant.pricePoisha : item.pricePoisha;
      const available = variant ? variant.stock : (item.stock ?? 0);
      const key = `${item.productId}:${variant?.id ?? ''}`;

      if (available <= 0) {
        setNotice({
          text:
            lang === 'bn'
              ? `${item.nameBn} এর স্টক নেই।`
              : `${item.nameEn} is out of stock.`,
          tone: 'error',
        });
        return;
      }

      setCart((current) => {
        const existing = current.find((line) => line.key === key);

        if (existing) {
          if (existing.quantity + 1 > existing.available) {
            setNotice({
              text:
                lang === 'bn'
                  ? `মাত্র ${existing.available}টি আছে।`
                  : `Only ${existing.available} in stock.`,
              tone: 'error',
            });
            return current;
          }
          return current.map((line) =>
            line.key === key ? { ...line, quantity: line.quantity + 1 } : line,
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
            unitPricePoisha,
            quantity: 1,
            available,
          },
        ];
      });

      setQuery('');
      setResults([]);
      searchRef.current?.focus();
    },
    [lang],
  );

  function setQuantity(key: string, next: number): void {
    setCart((current) =>
      current
        .map((line) =>
          line.key === key
            ? { ...line, quantity: Math.max(0, Math.min(next, line.available)) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  /**
   * Enter in the search box.
   *
   * A barcode scanner is a keyboard that types a SKU and presses Enter, so this
   * is the whole "scan to sell" path: an exact SKU match wins, otherwise a
   * single result is added, otherwise the cashier taps.
   */
  function onSearchEnter(): void {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return;

    const exact = results.find(
      (item) =>
        item.sku.toLowerCase() === trimmed ||
        item.variants.some((variant) => variant.sku.toLowerCase() === trimmed),
    );

    if (exact) {
      const variant = exact.variants.find((candidate) => candidate.sku.toLowerCase() === trimmed);
      addLine(exact, variant ?? (exact.variants.length === 1 ? exact.variants[0]! : null));
      return;
    }

    if (results.length === 1 && !results[0]!.hasVariants) addLine(results[0]!, null);
  }

  function resetSale(): void {
    setCart([]);
    setDiscountTaka('');
    setCashTaka('');
    setCustomerName('');
    setCustomerPhone('');
    setPaymentMethod('CASH');
    setClientRef(newClientRef());
    setReceipt(null);
    setQuery('');
    setResults([]);
  }

  // ─── Complete the sale ───────────────────────────────────────────────────

  async function complete(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setNotice(null);

    try {
      const sale = await createSale({
        clientRef,
        items: cart.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
        })),
        paymentMethod,
        ...(paymentMethod === 'CASH' ? { cashReceivedPoisha: cashPoisha } : {}),
        discountPoisha,
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
      });

      setReceipt(sale);
      setCart([]);
      setCashTaka('');
      setDiscountTaka('');

      // The session's totals are derived server-side; ask for them again rather
      // than incrementing a client copy that would drift.
      setSession(await getCurrentSession());
      router.refresh();
    } catch (error) {
      const message = (error as Error).message;
      setNotice({ text: message, tone: 'error' });

      // A shift closed in another tab is the one error that changes the screen.
      if (/shift/i.test(message)) setSession(null);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  if (receipt) {
    return (
      <ReceiptView
        lang={lang}
        sale={receipt}
        onNewSale={() => {
          resetSale();
          searchRef.current?.focus();
        }}
      />
    );
  }

  if (!session) {
    return (
      <>
        {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}
        <ShiftStart
          lang={lang}
          onOpened={(opened) => {
            setSession(opened);
            setNotice({
              text: lang === 'bn' ? 'শিফট শুরু হয়েছে।' : 'Shift open. Start selling.',
              tone: 'ok',
            });
          }}
        />
      </>
    );
  }

  return (
    <>
      {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}

      <div className="pos-bar">
        <div className="pos-bar-facts">
          <span className="pos-pill">
            <Wallet size={14} aria-hidden />
            {lang === 'bn' ? 'শিফট চলছে' : 'Shift open'}
          </span>
          <span className="pos-fact">
            {lang === 'bn' ? 'শুরু' : 'Opened'} {session.openedAt.slice(11, 16)}
          </span>
          <span className="pos-fact">
            {lang === 'bn' ? 'ড্রয়ার' : 'Float'} {formatMoneyAdmin(session.openingCashPoisha)}
          </span>
          <span className="pos-fact">
            {session.saleCount} {lang === 'bn' ? 'বিক্রয়' : 'sales'}
          </span>
          <span className="pos-fact">
            {formatMoneyAdmin(session.totalSalesPoisha)} {lang === 'bn' ? 'মোট' : 'taken'}
          </span>
        </div>

        <button type="button" className="btn ghost sm" onClick={() => setClosing(true)}>
          {lang === 'bn' ? 'শিফট বন্ধ করুন' : 'Close shift'}
        </button>
      </div>

      <div className="pos-screen">
        {/* ── Search and results ─────────────────────────────────────────── */}
        <section className="pos-main" aria-label={lang === 'bn' ? 'পণ্য খুঁজুন' : 'Find a product'}>
          <div className="pos-search">
            <Search size={16} aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSearchEnter();
                }
              }}
              placeholder={
                lang === 'bn'
                  ? 'নাম বা বারকোড স্ক্যান করুন'
                  : 'Scan a barcode, or type a name'
              }
              aria-label={lang === 'bn' ? 'পণ্য খুঁজুন' : 'Find a product'}
              autoComplete="off"
            />
            {query && (
              <button type="button" className="pos-search-clear" onClick={() => setQuery('')}>
                <X size={14} aria-hidden />
              </button>
            )}
          </div>

          <div className="pos-results">
            {searching && results.length === 0 && (
              <p className="pos-hint">{lang === 'bn' ? 'খোঁজা হচ্ছে…' : 'Searching…'}</p>
            )}

            {!searching && results.length === 0 && (
              <p className="pos-hint">
                {query
                  ? lang === 'bn'
                    ? 'কিছু পাওয়া যায়নি।'
                    : 'Nothing matched.'
                  : lang === 'bn'
                    ? 'প্রথম ২৪টি পণ্য দেখানো হচ্ছে।'
                    : 'Showing the first 24 products.'}
              </p>
            )}

            {results.map((item) => (
              <ProductTile key={item.productId} lang={lang} item={item} onAdd={addLine} />
            ))}
          </div>
        </section>

        {/* ── Basket and payment ─────────────────────────────────────────── */}
        <aside className="pos-side" aria-label={lang === 'bn' ? 'ঝুড়ি' : 'Basket'}>
          <div className="pos-cart">
            {cart.length === 0 ? (
              <p className="pos-hint pos-cart-empty">
                {lang === 'bn' ? 'ঝুড়ি খালি।' : 'Basket is empty.'}
              </p>
            ) : (
              cart.map((line) => (
                <div className="pos-line" key={line.key}>
                  <div className="pos-line-name">
                    <strong>{lang === 'bn' ? line.nameBn : line.nameEn}</strong>
                    <span className="pos-line-sku">{line.sku}</span>
                  </div>

                  <div className="pos-qty">
                    <button
                      type="button"
                      onClick={() => setQuantity(line.key, line.quantity - 1)}
                      aria-label={lang === 'bn' ? 'কমান' : 'Decrease'}
                    >
                      <Minus size={14} aria-hidden />
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.key, line.quantity + 1)}
                      aria-label={lang === 'bn' ? 'বাড়ান' : 'Increase'}
                    >
                      <Plus size={14} aria-hidden />
                    </button>
                  </div>

                  <div className="pos-line-total">
                    {formatMoneyAdmin(line.unitPricePoisha * line.quantity)}
                  </div>

                  <button
                    type="button"
                    className="pos-line-remove"
                    onClick={() => setQuantity(line.key, 0)}
                    aria-label={lang === 'bn' ? 'সরান' : 'Remove'}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="pos-totals">
            <div className="pos-total-row">
              <span>{lang === 'bn' ? 'সাবটোটাল' : 'Subtotal'}</span>
              <span>{formatMoneyAdmin(subtotalPoisha)}</span>
            </div>

            <label className="pos-total-row">
              <span>{lang === 'bn' ? 'ডিসকাউন্ট (৳)' : 'Discount (৳)'}</span>
              <input
                value={discountTaka}
                onChange={(event) => setDiscountTaka(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-invalid={discountTooLarge}
              />
            </label>

            {discountTooLarge && (
              <p className="pos-warn" role="alert">
                {lang === 'bn'
                  ? `সর্বোচ্চ ${formatMoneyAdmin(discountCapPoisha)} ডিসকাউন্ট দেওয়া যাবে।`
                  : `At most ${formatMoneyAdmin(discountCapPoisha)} can be discounted here.`}
              </p>
            )}

            <div className="pos-total-row is-grand">
              <span>{lang === 'bn' ? 'মোট' : 'Total'}</span>
              <strong>{formatMoneyAdmin(totalPoisha)}</strong>
            </div>
          </div>

          <div className="pos-pay">
            <div className="pos-pay-methods" role="group" aria-label="Payment method">
              {PAYMENT_METHODS.map((method) => {
                const Icon = method.icon;
                return (
                  <button
                    key={method.id}
                    type="button"
                    className={`pos-pay-btn${paymentMethod === method.id ? ' is-active' : ''}`}
                    onClick={() => setPaymentMethod(method.id)}
                    aria-pressed={paymentMethod === method.id}
                  >
                    <Icon size={16} aria-hidden />
                    {lang === 'bn' ? method.bn : method.en}
                  </button>
                );
              })}
            </div>

            {paymentMethod === 'CASH' && (
              <>
                <label className="pos-cash">
                  <span>{lang === 'bn' ? 'নগদ গৃহীত (৳)' : 'Cash received (৳)'}</span>
                  <input
                    value={cashTaka}
                    onChange={(event) => setCashTaka(event.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>

                <div className="pos-total-row">
                  <span>{lang === 'bn' ? 'ফেরত' : 'Change'}</span>
                  <strong>{formatMoneyAdmin(changePoisha)}</strong>
                </div>
              </>
            )}

            <button
              type="button"
              className="btn pos-complete"
              onClick={complete}
              disabled={!canSubmit}
            >
              {submitting
                ? lang === 'bn'
                  ? 'সংরক্ষণ হচ্ছে…'
                  : 'Saving…'
                : `${lang === 'bn' ? 'বিক্রয় সম্পন্ন' : 'Complete sale'} · ${formatMoneyAdmin(totalPoisha)}`}
            </button>

            <details className="pos-customer">
              <summary>{lang === 'bn' ? 'গ্রাহকের তথ্য (ঐচ্ছিক)' : 'Customer details (optional)'}</summary>
              <input
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder={lang === 'bn' ? 'মোবাইল নম্বর' : 'Mobile number'}
                inputMode="tel"
              />
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder={lang === 'bn' ? 'নাম' : 'Name'}
              />
            </details>
          </div>
        </aside>
      </div>

      {closing && (
        <CloseShiftDrawer
          lang={lang}
          session={session}
          onClose={() => setClosing(false)}
          onClosed={(closed) => {
            setSession(null);
            setClosing(false);
            setCart([]);
            setNotice({
              text:
                lang === 'bn'
                  ? `শিফট বন্ধ হয়েছে। ব্যবধান ${formatMoneyAdmin(Math.abs(closed.variancePoisha ?? 0))}।`
                  : `Shift closed. Variance ${formatMoneyAdmin(Math.abs(closed.variancePoisha ?? 0))}.`,
              tone: (closed.variancePoisha ?? 0) === 0 ? 'ok' : 'error',
            });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ─── Notice ────────────────────────────────────────────────────────────────

function Notice({
  notice,
  onDismiss,
}: {
  notice: { text: string; tone: 'ok' | 'error' };
  onDismiss: () => void;
}) {
  return (
    <div
      className={`ord-notice${notice.tone === 'error' ? ' is-error' : ''}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <span>{notice.text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

// ─── Product tile ──────────────────────────────────────────────────────────

function ProductTile({
  lang,
  item,
  onAdd,
}: {
  lang: Lang;
  item: PosCatalogItem;
  onAdd: (item: PosCatalogItem, variant: PosVariant | null) => void;
}) {
  /**
   * A product with one variant is added in one tap: making the cashier choose
   * between "500ml" and "500ml" is a tap that teaches them to hate the till.
   */
  const singleVariant = item.variants.length === 1 ? item.variants[0]! : null;

  if (item.hasVariants && !singleVariant) {
    return (
      <div className="pos-tile is-variants">
        <div className="pos-tile-head">
          <strong>{lang === 'bn' ? item.nameBn : item.nameEn}</strong>
          <span className="pos-line-sku">{item.sku}</span>
        </div>
        <div className="pos-variants">
          {item.variants.map((variant) => (
            <button
              key={variant.id}
              type="button"
              className="pos-variant"
              onClick={() => onAdd(item, variant)}
              disabled={variant.stock <= 0}
            >
              <span>{lang === 'bn' ? variant.nameBn : variant.nameEn}</span>
              <span className="pos-variant-meta">
                {formatMoneyAdmin(variant.pricePoisha)}
                <em className={variant.stock <= 0 ? 'is-out' : undefined}>{variant.stock}</em>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const price = singleVariant ? singleVariant.pricePoisha : item.pricePoisha;
  const stock = singleVariant ? singleVariant.stock : (item.stock ?? 0);

  return (
    <button
      type="button"
      className="pos-tile"
      onClick={() => onAdd(item, singleVariant)}
      disabled={stock <= 0}
    >
      <div className="pos-tile-head">
        <strong>{lang === 'bn' ? item.nameBn : item.nameEn}</strong>
        <span className="pos-line-sku">{singleVariant?.sku ?? item.sku}</span>
      </div>
      <div className="pos-tile-foot">
        <span className="pos-price">{formatMoneyAdmin(price)}</span>
        <span className={`badge ${stock <= 0 ? 'bad' : stock <= 5 ? 'warn' : 'ok'}`}>
          {stock <= 0
            ? lang === 'bn'
              ? 'স্টক নেই'
              : 'Out'
            : `${stock} ${lang === 'bn' ? 'টি' : 'left'}`}
        </span>
      </div>
    </button>
  );
}

// ─── Shift start ───────────────────────────────────────────────────────────

function ShiftStart({ lang, onOpened }: { lang: Lang; onOpened: (session: PosSession) => void }) {
  const [floatTaka, setFloatTaka] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const session = await openShift({
        openingCashPoisha: takaToPoisha(floatTaka),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onOpened(session);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-start">
      <div className="pos-start-card">
        <h2>{lang === 'bn' ? 'শিফট শুরু করুন' : 'Start a shift'}</h2>
        <p className="sub">
          {lang === 'bn'
            ? 'ড্রয়ারে যে নগদ আছে সেটি গুনে লিখুন। শিফট ছাড়া বিক্রয় করা যাবে না, কারণ তাহলে দিনশেষে ড্রয়ার মেলানো যাবে না।'
            : 'Count the cash already in the drawer and enter it. Sales are refused until a shift is open, because a sale with no shift cannot be reconciled at the end of the day.'}
        </p>

        {error && (
          <div className="ord-notice is-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        <label className="field">
          <span>{lang === 'bn' ? 'শুরুর নগদ (৳)' : 'Opening cash (৳)'}</span>
          <input
            value={floatTaka}
            onChange={(event) => setFloatTaka(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            autoFocus
          />
        </label>

        <label className="field">
          <span>{lang === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Note (optional)'}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
        </label>

        <button type="button" className="btn" onClick={start} disabled={busy}>
          {busy
            ? lang === 'bn'
              ? 'খোলা হচ্ছে…'
              : 'Opening…'
            : lang === 'bn'
              ? 'শিফট শুরু করুন'
              : 'Open shift'}
        </button>
      </div>
    </div>
  );
}

// ─── Close shift ───────────────────────────────────────────────────────────

function CloseShiftDrawer({
  lang,
  session,
  onClose,
  onClosed,
}: {
  lang: Lang;
  session: PosSession;
  onClose: () => void;
  onClosed: (session: PosSession) => void;
}) {
  const [countedTaka, setCountedTaka] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedPoisha = takaToPoisha(countedTaka);
  const variance = countedTaka === '' ? null : countedPoisha - session.expectedCashPoisha;

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const closed = await closeShift(session.id, {
        countedCashPoisha: countedPoisha,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onClosed(closed);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={lang === 'bn' ? 'শিফট বন্ধ' : 'Close shift'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>{lang === 'bn' ? 'শিফট বন্ধ করুন' : 'Close the shift'}</h2>
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

          <div className="pos-z">
            <div className="pos-total-row">
              <span>{lang === 'bn' ? 'বিক্রয় সংখ্যা' : 'Sales'}</span>
              <span>{session.saleCount}</span>
            </div>
            <div className="pos-total-row">
              <span>{lang === 'bn' ? 'নগদ বিক্রয়' : 'Cash sales'}</span>
              <span>{formatMoneyAdmin(session.cashSalesPoisha)}</span>
            </div>
            <div className="pos-total-row">
              <span>{lang === 'bn' ? 'কার্ড' : 'Card'}</span>
              <span>{formatMoneyAdmin(session.cardSalesPoisha)}</span>
            </div>
            <div className="pos-total-row">
              <span>{lang === 'bn' ? 'মোবাইল ওয়ালেট' : 'Mobile wallet'}</span>
              <span>{formatMoneyAdmin(session.otherSalesPoisha)}</span>
            </div>
            <div className="pos-total-row">
              <span>{lang === 'bn' ? 'শুরুর নগদ' : 'Opening float'}</span>
              <span>{formatMoneyAdmin(session.openingCashPoisha)}</span>
            </div>
            <div className="pos-total-row is-grand">
              <span>{lang === 'bn' ? 'ড্রয়ারে থাকা উচিত' : 'Expected in drawer'}</span>
              <strong>{formatMoneyAdmin(session.expectedCashPoisha)}</strong>
            </div>
          </div>

          <label className="field">
            <span>{lang === 'bn' ? 'গুনে পাওয়া নগদ (৳)' : 'Cash counted (৳)'}</span>
            <input
              value={countedTaka}
              onChange={(event) => setCountedTaka(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              autoFocus
            />
          </label>

          {variance !== null && (
            <div className={`pos-variance${variance === 0 ? ' is-ok' : ' is-bad'}`} role="status">
              {variance === 0
                ? lang === 'bn'
                  ? 'ড্রয়ার মিলে গেছে।'
                  : 'The drawer balances.'
                : lang === 'bn'
                  ? `${variance > 0 ? 'বেশি' : 'কম'} ${formatMoneyAdmin(Math.abs(variance))}`
                  : `${variance > 0 ? 'Over' : 'Short'} by ${formatMoneyAdmin(Math.abs(variance))}`}
            </div>
          )}

          <label className="field">
            <span>{lang === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Note (optional)'}</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          </label>

          <button
            type="button"
            className="btn"
            onClick={confirm}
            disabled={busy || countedTaka === ''}
          >
            {busy
              ? lang === 'bn'
                ? 'বন্ধ হচ্ছে…'
                : 'Closing…'
              : lang === 'bn'
                ? 'শিফট বন্ধ করুন'
                : 'Close shift'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Receipt ───────────────────────────────────────────────────────────────

/**
 * The 80mm receipt.
 *
 * Everything above the `no-print` line is screen chrome; the paper is
 * `.pos-receipt`, and `admin.css` makes it the only thing on the page when the
 * browser prints. Sizes are in millimetres so a thermal printer does not have to
 * be told twice.
 */
function ReceiptView({
  lang,
  sale,
  onNewSale,
}: {
  lang: Lang;
  sale: PosSale;
  onNewSale: () => void;
}) {
  const when = new Date(sale.createdAt);

  return (
    <div className="pos-receipt-wrap">
      <div className="pos-receipt-actions no-print">
        <button type="button" className="btn" onClick={() => window.print()}>
          <Printer size={16} aria-hidden />
          {lang === 'bn' ? 'প্রিন্ট করুন' : 'Print receipt'}
        </button>
        <button type="button" className="btn ghost" onClick={onNewSale}>
          {lang === 'bn' ? 'নতুন বিক্রয়' : 'New sale'}
        </button>
      </div>

      <div className="pos-receipt">
        <div className="pos-receipt-head">
          <strong>{sale.shop.name}</strong>
          {sale.shop.address && <span>{sale.shop.address}</span>}
          {sale.shop.phone && <span>{sale.shop.phone}</span>}
        </div>

        <div className="pos-receipt-meta">
          <span>{sale.orderNumber}</span>
          <span>
            {when.toLocaleDateString('en-GB')} {when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <table className="pos-receipt-table">
          <thead>
            <tr>
              <th>{lang === 'bn' ? 'পণ্য' : 'Item'}</th>
              <th>{lang === 'bn' ? 'সং' : 'Qty'}</th>
              <th>{lang === 'bn' ? 'দাম' : 'Amount'}</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, index) => (
              <tr key={`${item.sku}-${index}`}>
                <td>
                  {lang === 'bn' ? item.nameBn : item.nameEn}
                  <em>{item.sku}</em>
                </td>
                <td>{item.quantity}</td>
                <td>{formatMoneyAdmin(item.lineTotalPoisha)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pos-receipt-totals">
          <div>
            <span>{lang === 'bn' ? 'সাবটোটাল' : 'Subtotal'}</span>
            <span>{formatMoneyAdmin(sale.subtotalPoisha)}</span>
          </div>
          {sale.discountPoisha > 0 && (
            <div>
              <span>{lang === 'bn' ? 'ডিসকাউন্ট' : 'Discount'}</span>
              <span>-{formatMoneyAdmin(sale.discountPoisha)}</span>
            </div>
          )}
          <div className="is-grand">
            <span>{lang === 'bn' ? 'মোট' : 'Total'}</span>
            <strong>{formatMoneyAdmin(sale.totalPoisha)}</strong>
          </div>
          <div>
            <span>{lang === 'bn' ? 'পেমেন্ট' : 'Paid by'}</span>
            <span>{sale.paymentMethod}</span>
          </div>
          {sale.paymentMethod === 'CASH' && (
            <>
              <div>
                <span>{lang === 'bn' ? 'নগদ' : 'Cash'}</span>
                <span>{formatMoneyAdmin(sale.cashReceivedPoisha)}</span>
              </div>
              <div>
                <span>{lang === 'bn' ? 'ফেরত' : 'Change'}</span>
                <span>{formatMoneyAdmin(sale.changePoisha)}</span>
              </div>
            </>
          )}
        </div>

        <div className="pos-receipt-foot">
          {sale.customerPhone && <span>{sale.customerPhone}</span>}
          <span>
            {lang === 'bn' ? 'বিক্রেতা' : 'Served by'} {sale.cashierName || '—'}
          </span>
          <span>{lang === 'bn' ? 'ধন্যবাদ।' : 'Thank you.'}</span>
        </div>
      </div>
    </div>
  );
}
