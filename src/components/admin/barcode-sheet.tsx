'use client';

/**
 * Barcode sheet — the client island for `/admin/barcodes`.
 *
 * Everything is generated in the browser from the SKU: no endpoint, no image, no
 * round trip. A label is a rectangle and some bars, and printing is the browser's
 * job.
 *
 * Printing hides the admin chrome through the `@media print` rules in admin.css —
 * a print stylesheet that leaves a sidebar on the page is a print stylesheet that
 * wastes the first sheet of every run.
 */

import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';

import { code39, BarcodeError } from '@/lib/barcode';

type Lang = 'en' | 'bn';

interface LabelProduct {
  id: string;
  nameEn: string;
  sku: string;
  barcode: string | null;
}

const SIZES = {
  small: { barHeight: 34, fontSize: 9, width: 46 },
  medium: { barHeight: 52, fontSize: 11, width: 64 },
} as const;

type SizeKey = keyof typeof SIZES;

export function BarcodeSheet({ lang, products }: { lang: Lang; products: LabelProduct[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(products.slice(0, 6).map((p) => p.id)));
  const [size, setSize] = useState<SizeKey>('medium');
  const [copies, setCopies] = useState(1);

  const labels = useMemo(() => {
    return products
      .filter((product) => selected.has(product.id))
      .flatMap((product) => {
        const value = product.barcode?.trim() || product.sku;
        let bars = null;
        let width = 0;
        let error: string | null = null;

        try {
          const encoded = code39(value);
          bars = encoded.bars;
          width = encoded.width;
        } catch (caught) {
          error = caught instanceof BarcodeError ? caught.message : 'cannot encode';
        }

        return Array.from({ length: Math.max(1, copies) }, () => ({
          key: `${product.id}-${Math.random().toString(36).slice(2, 7)}`,
          name: product.nameEn,
          value,
          bars,
          width,
          error,
        }));
      });
  }, [products, selected, copies]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="prod-toolbar ord-toolbar no-print">
        <div className="prod-search">
          <span className="cpn-hint">
            {lang === 'bn'
              ? 'SKU থেকে Code 39 — কোনো সার্ভার লাগে না'
              : 'Code 39 from the SKU — no server involved'}
          </span>
        </div>
        <div className="prod-filters">
          <select value={size} onChange={(event) => setSize(event.target.value as SizeKey)} aria-label="Label size">
            <option value="small">{lang === 'bn' ? 'ছোট' : 'Small'}</option>
            <option value="medium">{lang === 'bn' ? 'মাঝারি' : 'Medium'}</option>
          </select>

          <select value={copies} onChange={(event) => setCopies(Number(event.target.value))} aria-label="Copies">
            {[1, 2, 3, 5, 10].map((count) => (
              <option key={count} value={count}>
                ×{count}
              </option>
            ))}
          </select>

          <button type="button" className="btn" onClick={() => window.print()} disabled={labels.length === 0}>
            <Printer size={16} aria-hidden />
            {lang === 'bn' ? 'প্রিন্ট' : 'Print'}
          </button>
        </div>
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div className="barcode-picker">
          {products.map((product) => (
            <label key={product.id} className="barcode-pick">
              <input
                type="checkbox"
                checked={selected.has(product.id)}
                onChange={() => toggle(product.id)}
              />
              <span>
                {product.nameEn}
                <small>{product.barcode?.trim() || product.sku}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      {labels.length === 0 ? (
        <div className="card prod-empty no-print">
          <p>{lang === 'bn' ? 'কোনো পণ্য বেছে নিন।' : 'Pick at least one product.'}</p>
        </div>
      ) : (
        <div className="barcode-sheet">
          {labels.map((label) => (
            <div
              key={label.key}
              className="barcode-label"
              style={{ width: `${SIZES[size].width}mm` }}
            >
              {label.error || !label.bars ? (
                <div className="barcode-error">{label.error ?? '—'}</div>
              ) : (
                <svg
                  viewBox={`0 0 ${label.width} 60`}
                  width="100%"
                  height={SIZES[size].barHeight}
                  role="img"
                  aria-label={`Barcode ${label.value}`}
                  preserveAspectRatio="none"
                >
                  <rect width={label.width} height="60" fill="#fff" />
                  {label.bars.map((bar) => (
                    <rect key={bar.x} x={bar.x} y="0" width={bar.width} height="60" fill="#000" />
                  ))}
                </svg>
              )}
              <div className="barcode-value" style={{ fontSize: SIZES[size].fontSize }}>
                {label.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="cpn-hint no-print" style={{ marginTop: 14 }}>
        {lang === 'bn'
          ? 'Code 39: শুধু A–Z, 0–9, space এবং - . $ / + % চলবে। প্রোডাক্টের barcode থাকলে সেটাই, নাহলে SKU।'
          : 'Code 39 accepts A–Z, 0–9, space and - . $ / + %. Uses the product barcode when set, otherwise the SKU.'}
      </p>
    </>
  );
}
