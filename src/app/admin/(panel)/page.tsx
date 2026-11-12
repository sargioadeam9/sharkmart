/**
 * Dashboard — `/admin`.
 *
 * Every figure on this page comes from `GET /api/v1/admin/dashboard`. Nothing is
 * computed in the browser from a list endpoint, and nothing is invented.
 *
 * ── A note on the KPI cards ─────────────────────────────────────────────────
 *
 * The reference shows four cards: Revenue, Orders, Estimated profit, Average
 * order. This schema has no product cost field, so "Estimated profit" is not
 * computable — and a fabricated margin on an operator's dashboard is worse than
 * a missing card. The fourth slot holds "Delivered" instead, which the data can
 * prove. Recorded in HANDOFF.md as a schema gap.
 *
 * The page is a server component: it fetches once, renders once, and ships no
 * data-fetching JavaScript. The range selector is the only client island.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Package, ShoppingCart, Wallet } from 'lucide-react';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { formatMoneyAdmin } from '@/lib/format';
import { getLang } from '@/lib/locale';
import { DashboardRange } from '@/components/admin/dashboard-range';
import { SalesChart } from '@/components/admin/sales-chart';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

interface DashboardData {
  range: { from: string; to: string };
  kpis: {
    revenuePoisha: number;
    orderCount: number;
    deliveredCount: number;
    cancelledCount: number;
    paidOnlinePoisha: number;
    averageOrderPoisha: number;
  };
  series: Array<{ date: string; orders: number; revenuePoisha: number }>;
  pipeline: Array<{ status: string; count: number }>;
  needsAttention: Array<{
    key: string;
    labelEn: string;
    labelBn: string;
    count: number;
    href: string;
    severity: 'high' | 'warn' | 'ok';
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string;
    totalPoisha: number;
    itemCount: number;
    customerName: string;
    district: string | null;
    createdAt: string;
  }>;
  bestSellers: Array<{
    productId: string;
    nameEn: string;
    nameBn: string;
    slug: string | null;
    sku: string | null;
    unitsSold: number;
    revenuePoisha: number;
  }>;
  couriers: Array<{
    courier: string;
    delivered: number;
    returned: number;
    total: number;
    deliveryRate: number | null;
  }>;
}

/** Status → badge class. Text is always kept; colour is never the only signal. */
const STATUS_TONE: Record<string, string> = {
  PENDING: 'warn',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'ok',
  CANCELLED: 'bad',
  RETURNED: 'bad',
  REFUND_PENDING: 'warn',
  REFUNDED: 'mute',
};

const STATUS_LABEL_BN: Record<string, string> = {
  PENDING: 'পেন্ডিং',
  CONFIRMED: 'নিশ্চিত',
  PROCESSING: 'প্রসেসিং',
  SHIPPED: 'পাঠানো হয়েছে',
  DELIVERED: 'ডেলিভারি হয়েছে',
  CANCELLED: 'বাতিল',
  RETURNED: 'ফেরত',
  REFUND_PENDING: 'রিফান্ড অপেক্ষমাণ',
  REFUNDED: 'রিফান্ড হয়েছে',
};

function statusLabel(status: string, lang: 'en' | 'bn'): string {
  if (lang === 'bn') return STATUS_LABEL_BN[status] ?? status;
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(iso: string, lang: 'en' | 'bn'): string {
  const date = new Date(iso);
  return date.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

function formatTime(iso: string, lang: 'en' | 'bn'): string {
  const date = new Date(iso);
  return date.toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const lang = await getLang();
  const params = await searchParams;

  const preset = params.range ?? '7d';
  const query = new URLSearchParams({ range: preset });
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);

  let data: DashboardData;
  try {
    const response = await adminFetchServer<DashboardData>(`/admin/dashboard?${query.toString()}`);
    data = response.data;
  } catch (error) {
    const message =
      error instanceof AdminApiError
        ? error.message
        : lang === 'bn'
          ? 'ড্যাশবোর্ড লোড করা যায়নি।'
          : 'The dashboard could not be loaded.';

    return (
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>{lang === 'bn' ? 'লোড করা যায়নি' : 'Could not load'}</h2>
        <p style={{ color: 'var(--muted)' }}>{message}</p>
      </div>
    );
  }

  const { kpis, series, pipeline, needsAttention, recentOrders, bestSellers, couriers } = data;

  const pipelineTotal = pipeline.reduce((sum, stage) => sum + stage.count, 0);
  const maxStage = Math.max(...pipeline.map((stage) => stage.count), 1);
  const openAttention = needsAttention.filter((item) => item.count > 0);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'}</h1>
          <p className="sub">
            {lang === 'bn' ? 'আজকের দোকানের অবস্থা।' : 'Here is how the store is doing.'}
          </p>
        </div>
        <div className="actions">
          <DashboardRange current={preset} lang={lang} />
          <Link href="/admin/orders" className="btn ghost">
            <ShoppingCart size={16} aria-hidden />
            {lang === 'bn' ? 'নতুন অর্ডার' : 'New order'}
          </Link>
          <Link href="/admin/products" className="btn">
            {lang === 'bn' ? 'পণ্য যোগ করুন' : 'Add product'}
          </Link>
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <section className="grid-4" aria-label={lang === 'bn' ? 'মূল মেট্রিক' : 'Key metrics'}>
        <article className="card kpi hero">
          <div className="label">
            <Wallet size={18} aria-hidden />
            {lang === 'bn' ? 'ডেলিভারি আয়' : 'Delivered revenue'}
          </div>
          <div className="value">{formatMoneyAdmin(kpis.revenuePoisha)}</div>
          <div className="foot">
            <span>
              {lang === 'bn'
                ? `${kpis.deliveredCount}টি ডেলিভারি`
                : `${kpis.deliveredCount} delivered`}
            </span>
          </div>
        </article>

        <article className="card kpi">
          <div className="label">
            <ShoppingCart size={18} aria-hidden />
            {lang === 'bn' ? 'অর্ডার' : 'Orders'}
          </div>
          <div className="value">{kpis.orderCount.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN')}</div>
          <div className="foot">
            <span>
              {lang === 'bn'
                ? `${kpis.cancelledCount}টি বাতিল`
                : `${kpis.cancelledCount} cancelled`}
            </span>
          </div>
        </article>

        <article className="card kpi">
          <div className="label">
            <Package size={18} aria-hidden />
            {lang === 'bn' ? 'ডেলিভারি হয়েছে' : 'Delivered'}
          </div>
          <div className="value">
            {kpis.deliveredCount.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN')}
          </div>
          <div className="foot">
            <span>
              {kpis.orderCount > 0
                ? `${Math.round((kpis.deliveredCount / kpis.orderCount) * 100)}% ${
                    lang === 'bn' ? 'সফল' : 'of orders'
                  }`
                : lang === 'bn'
                  ? 'কোনো অর্ডার নেই'
                  : 'No orders yet'}
            </span>
          </div>
        </article>

        <article className="card kpi">
          <div className="label">
            <Wallet size={18} aria-hidden />
            {lang === 'bn' ? 'গড় অর্ডার' : 'Average order'}
          </div>
          <div className="value">{formatMoneyAdmin(kpis.averageOrderPoisha)}</div>
          <div className="foot">
            <span>
              {lang === 'bn'
                ? `অনলাইন পেমেন্ট ${formatMoneyAdmin(kpis.paidOnlinePoisha)}`
                : `Online ${formatMoneyAdmin(kpis.paidOnlinePoisha)}`}
            </span>
          </div>
        </article>
      </section>

      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <section className="card" style={{ marginBottom: 18 }} aria-label={lang === 'bn' ? 'অর্ডার পাইপলাইন' : 'Order pipeline'}>
        <div className="card-head">
          <h2>{lang === 'bn' ? 'অর্ডার পাইপলাইন' : 'Order pipeline'}</h2>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {lang === 'bn' ? `${pipelineTotal}টি সক্রিয়` : `${pipelineTotal} active`}
          </span>
        </div>
        <div className="pipeline">
          {pipeline.map((stage) => (
            <Link
              key={stage.status}
              href={`/admin/orders?status=${stage.status}`}
              className={stage.status === 'PROCESSING' ? 'step focus' : 'step'}
            >
              <span>{statusLabel(stage.status, lang)}</span>
              <b>{stage.count.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN')}</b>
              <i>
                <em style={{ width: `${Math.round((stage.count / maxStage) * 100)}%` }} />
              </i>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Sales chart + needs attention ────────────────────────────────── */}
      <section className="grid-main">
        <article className="card">
          <div className="card-head">
            <h2>{lang === 'bn' ? 'বিক্রয়' : 'Sales'}</h2>
            <div className="legend">
              <span>
                <i />
                {lang === 'bn' ? 'অর্ডার' : 'Orders'}
              </span>
            </div>
          </div>
          <SalesChart series={series} lang={lang} />
        </article>

        <article className="card">
          <div className="card-head">
            <h2>{lang === 'bn' ? 'মনোযোগ প্রয়োজন' : 'Needs attention'}</h2>
          </div>
          {openAttention.length === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: 'var(--ok)',
                padding: '14px 0',
              }}
            >
              <CheckCircle2 size={20} aria-hidden />
              <span>{lang === 'bn' ? 'সব ঠিক আছে।' : 'All clear.'}</span>
            </div>
          ) : (
            <div className="alert-list">
              {openAttention.map((item) => (
                <Link key={item.key} href={item.href} className="alert">
                  <span className={`chip ${item.severity === 'high' ? 'bad' : 'warn'}`}>
                    <AlertTriangle size={18} aria-hidden />
                  </span>
                  <div>
                    <b className="n">{item.count}</b>
                    <small>{lang === 'bn' ? item.labelBn : item.labelEn}</small>
                  </div>
                  <ArrowRight size={16} aria-hidden style={{ color: 'var(--faint)' }} />
                </Link>
              ))}
            </div>
          )}
        </article>
      </section>

      {/* ── Recent orders ────────────────────────────────────────────────── */}
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h2>{lang === 'bn' ? 'সাম্প্রতিক অর্ডার' : 'Recent orders'}</h2>
          <Link href="/admin/orders" className="link">
            {lang === 'bn' ? 'সব দেখুন' : 'View all'}
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <p className="empty">
            {lang === 'bn' ? 'এখনো কোনো অর্ডার নেই।' : 'No orders yet.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{lang === 'bn' ? 'অর্ডার' : 'Order'}</th>
                  <th>{lang === 'bn' ? 'গ্রাহক' : 'Customer'}</th>
                  <th>{lang === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
                  <th>{lang === 'bn' ? 'পেমেন্ট' : 'Payment'}</th>
                  <th className="num">{lang === 'bn' ? 'মোট' : 'Total'}</th>
                  <th>{lang === 'bn' ? 'সময়' : 'Placed'}</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td data-label={lang === 'bn' ? 'অর্ডার' : 'Order'}>
                      <span className="who">
                        #{order.orderNumber}
                        <small>
                          {order.itemCount} {lang === 'bn' ? 'আইটেম' : 'item'}
                          {order.itemCount === 1 ? '' : 's'}
                        </small>
                      </span>
                    </td>
                    <td data-label={lang === 'bn' ? 'গ্রাহক' : 'Customer'}>
                      <span className="who">
                        {order.customerName}
                        <small>{order.district ?? '—'}</small>
                      </span>
                    </td>
                    <td data-label={lang === 'bn' ? 'স্ট্যাটাস' : 'Status'}>
                      <span className={`badge ${STATUS_TONE[order.status] ?? 'mute'}`}>
                        {statusLabel(order.status, lang)}
                      </span>
                    </td>
                    <td data-label={lang === 'bn' ? 'পেমেন্ট' : 'Payment'}>
                      {order.paymentMethod}
                      <small style={{ display: 'block', color: 'var(--muted)' }}>
                        {order.paymentStatus}
                      </small>
                    </td>
                    <td className="num" data-label={lang === 'bn' ? 'মোট' : 'Total'}>
                      {formatMoneyAdmin(order.totalPoisha)}
                    </td>
                    <td data-label={lang === 'bn' ? 'সময়' : 'Placed'}>
                      {formatDate(order.createdAt, lang)}{' '}
                      <span style={{ color: 'var(--faint)' }}>{formatTime(order.createdAt, lang)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Best sellers + couriers ──────────────────────────────────────── */}
      <section className="grid-main">
        <article className="card">
          <div className="card-head">
            <h2>{lang === 'bn' ? 'সেরা বিক্রেতা' : 'Best sellers'}</h2>
          </div>
          {bestSellers.length === 0 ? (
            <p className="empty">
              {lang === 'bn'
                ? 'এই সময়ে কোনো ডেলিভারি হয়নি।'
                : 'No delivered sales in this range.'}
            </p>
          ) : (
            <div className="rank">
              {bestSellers.map((product, index) => (
                <div key={product.productId} className="rank-item">
                  <span className="thumb" aria-hidden>
                    {index + 1}
                  </span>
                  <div>
                    <b className="ellip">{lang === 'bn' ? product.nameBn : product.nameEn}</b>
                    <small>
                      {product.unitsSold} {lang === 'bn' ? 'বিক্রি' : 'sold'} ·{' '}
                      {formatMoneyAdmin(product.revenuePoisha)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <div className="card-head">
            <h2>{lang === 'bn' ? 'কুরিয়ার ডেলিভারি হার' : 'Courier delivery rates'}</h2>
          </div>
          {couriers.length === 0 ? (
            <p className="empty">
              {lang === 'bn' ? 'কোনো কুরিয়ার বুকিং নেই।' : 'No courier bookings yet.'}
            </p>
          ) : (
            <div className="rank">
              {couriers.map((courier) => (
                <div key={courier.courier}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <b>{courier.courier}</b>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {courier.deliveryRate === null
                        ? lang === 'bn'
                          ? 'কোনো ডেটা নেই'
                          : 'No data'
                        : `${courier.deliveryRate}%`}
                    </span>
                  </div>
                  <div className={`meter ${(courier.deliveryRate ?? 0) >= 90 ? 'ok' : ''}`}>
                    <i style={{ width: `${courier.deliveryRate ?? 0}%` }} />
                  </div>
                  <small style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    {courier.delivered} {lang === 'bn' ? 'ডেলিভারি' : 'delivered'} ·{' '}
                    {courier.returned} {lang === 'bn' ? 'ফেরত' : 'returned'} ·{' '}
                    {courier.total} {lang === 'bn' ? 'মোট' : 'total'}
                  </small>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </>
  );
}
