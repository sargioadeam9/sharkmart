/**
 * Barcodes — `/admin/barcodes` (Phase 10 pass L).
 *
 * Server component: fetches a page of products for the picker and hands them to the
 * island, which renders the bars from the SKU in the browser. There is no barcode
 * endpoint because there is nothing to compute server-side — the encoder is a pure
 * function and a label is a rectangle.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import { BarcodeSheet } from '@/components/admin/barcode-sheet';

export const metadata: Metadata = {
  title: 'Barcodes',
  robots: { index: false, follow: false },
};

interface ProductRow {
  id: string;
  nameEn: string;
  sku: string;
  barcode: string | null;
}

export default async function BarcodesPage() {
  const lang = await getLang();

  let products: ProductRow[] = [];
  let error: string | null = null;

  try {
    const response = await adminFetchServer<{ items: ProductRow[] }>(
      '/admin/products?limit=100&sort=updated',
    );
    products = response.data.items;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'পণ্য লোড করা যায়নি।'
          : 'Could not load products.';
  }

  return (
    <>
      <div className="title-row no-print">
        <div>
          <h1>{lang === 'bn' ? 'বারকোড' : 'Barcodes'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${products.length}টি পণ্য · লেবেল বেছে নিয়ে প্রিন্ট করুন`
              : `${products.length} products · pick labels, then print`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <BarcodeSheet lang={lang} products={products} />
      )}
    </>
  );
}
