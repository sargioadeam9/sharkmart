/**
 * `/track` — public order tracking.
 *
 * Requires BOTH the order number and the phone used at checkout. That pair is
 * the whole security model: an order number alone is guessable-ish and a phone
 * alone is not secret, but the combination is not enumerable at any useful rate
 * — and the server rate-limits the endpoint on top.
 *
 * The result deliberately has no internal id (the server's public view strips
 * it), so this page cannot be used to discover one.
 *
 * `?order=` prefills the number from the confirmation page, which is the only
 * place a shopper reliably has it to hand.
 */

'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import type { TrackedOrder } from '@/types/account';
import { useLang } from '@/lib/hooks';
import { trackOrder } from '@/lib/api/account';
import { isValidBdPhone, normaliseBdPhone } from '@/lib/account-validation';
import { formatMoney } from '@/lib/format';
import { localized } from '@/types/catalog';
import { Field, FormAlert } from '@/components/account/form-fields';
import { OrderStatusBadge, useOrderStatusLabel } from '@/components/account/order-status-badge';

export function TrackPage() {
  const { lang, tu } = useLang();
  const statusLabel = useOrderStatusLabel();
  const searchParams = useSearchParams();

  /**
   * Prefill from the confirmation link.
   *
   * Seeded into `useState` rather than set from an effect: the query string is
   * known at first render, so an effect would only add a frame of an empty
   * field and a cascading render.
   */
  const [orderNumber, setOrderNumber] = useState(
    () => searchParams.get('order') ?? '',
  );
  const [phone, setPhone] = useState('');

  const [result, setResult] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setNotFound(false);
      setResult(null);

      if (!orderNumber.trim()) {
        setError(tu('trackOrderNumber'));
        return;
      }

      if (!isValidBdPhone(phone)) {
        setError(tu('invalidPhone'));
        return;
      }

      setSearching(true);
      try {
        const tracked = await trackOrder(orderNumber.trim(), normaliseBdPhone(phone));
        setResult(tracked);
      } catch (caught) {
        const code =
          typeof caught === 'object' && caught !== null && 'status' in caught
            ? (caught as { status: number }).status
            : 0;

        // 404 is the honest answer for a wrong pair — the server does not say
        // which half was wrong, and neither should this page.
        if (code === 404) setNotFound(true);
        else if (code === 429) setError(tu('rateLimited'));
        else setError(tu('errorBody'));
      } finally {
        setSearching(false);
      }
    },
    [orderNumber, phone, tu],
  );

  return (
    <div className="acct-auth-wrap" style={{ maxWidth: 620 }}>
      <div className="acct-card">
        <h2>{tu('trackTitle')}</h2>
        <p className="acct-card-sub">{tu('trackSubtitle')}</p>

        <form className="acct-form" onSubmit={handleSubmit} noValidate>
          {error && <FormAlert tone="error">{error}</FormAlert>}

          <Field
            label={tu('trackOrderNumber')}
            value={orderNumber}
            onChange={setOrderNumber}
            placeholder="SM-XXXXXXXX"
            autoComplete="off"
            required
          />

          <Field
            label={tu('trackPhone')}
            value={phone}
            onChange={setPhone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="01712345678"
            hint={tu('phoneHint')}
            required
          />

          <button type="submit" className="btn red acct-submit" disabled={searching}>
            {searching ? tu('loading') : tu('trackSubmit')}
          </button>
        </form>
      </div>

      {notFound && (
        <div className="acct-card">
          <FormAlert tone="info">
            <strong>{tu('trackNotFound')}</strong>
            <br />
            {tu('trackNotFoundBody')}
          </FormAlert>
        </div>
      )}

      {result && (
        <div className="acct-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 14,
            }}
          >
            <h2 style={{ fontSize: 16 }}>{result.orderNumber}</h2>
            <OrderStatusBadge status={result.status} />
          </div>

          <div className="acct-rows">
            <div className="acct-row">
              <span>{tu('orderDate')}</span>
              <b>{formatDate(result.createdAt, lang)}</b>
            </div>
            <div className="acct-row">
              <span>{tu('orderTotal')}</span>
              <b>{formatMoney(result.totalAmountPoisha, lang)}</b>
            </div>
            {result.courierName && (
              <div className="acct-row">
                <span>{tu('trackingCourier')}</span>
                <b>{result.courierName}</b>
              </div>
            )}
            {result.consignmentId && (
              <div className="acct-row">
                <span>{tu('trackingConsignment')}</span>
                <b>{result.consignmentId}</b>
              </div>
            )}
          </div>

          <div className="acct-divider" />

          <ul className="acct-timeline">
            {result.statusHistory.map((entry, index) => (
              <li
                key={`${entry.status}-${index}`}
                className={
                  index === result.statusHistory.length - 1 ? 'is-current' : undefined
                }
              >
                <div className="acct-timeline-status">
                  {statusLabel(entry.status as TrackedOrder['status'])}
                </div>
                {entry.note && <div className="acct-timeline-note">{entry.note}</div>}
                <div className="acct-timeline-time">{formatDate(entry.createdAt, lang)}</div>
              </li>
            ))}
          </ul>

          <div className="acct-divider" />

          <div className="acct-rows">
            {result.items.map((item, index) => (
              <div key={index} className="acct-row">
                <span>{localized(lang, item.nameEn, item.nameBn)}</span>
                <b>× {item.quantity}</b>
              </div>
            ))}
          </div>

          {result.trackingUrl && (
            <div className="acct-actions">
              <a
                className="btn line"
                href={result.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tu('trackOrder')} ↗
              </a>
            </div>
          )}
        </div>
      )}

      <p className="acct-switch" style={{ marginTop: 16 }}>
        <Link href="/orders" className="acct-link">
          {tu('myOrders')}
        </Link>
      </p>
    </div>
  );
}

function formatDate(iso: string, lang: 'en' | 'bn'): string {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}
