/**
 * New product — `/admin/products/new`.
 *
 * The form is the same component the edit route uses, with `product: null`. The
 * create itself is a `POST` that always lands as a draft; the editor then
 * replaces the URL with the real id so a refresh does not create a second row.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type { ProductFormOptions } from '@/lib/api/admin-products';
import { ProductEditor } from '@/components/admin/product-editor';

export const metadata: Metadata = {
  title: 'New product',
  robots: { index: false, follow: false },
};

export default async function NewProductPage() {
  const lang = await getLang();

  let options: ProductFormOptions = { categories: [], brands: [] };
  let error: string | null = null;

  try {
    const response = await adminFetchServer<ProductFormOptions>('/admin/products/form-options');
    options = response.data;
  } catch (caught) {
    error = caught instanceof AdminApiError ? caught.message : 'Could not load form options.';
  }

  return (
    <>
      <div className="title-row">
        <div>
          <Link href="/admin/products" className="editor-back">
            <ArrowLeft size={14} aria-hidden />
            {lang === 'bn' ? 'পণ্যে ফিরুন' : 'Back to products'}
          </Link>
          <h1>{lang === 'bn' ? 'নতুন পণ্য' : 'New product'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? 'নতুন পণ্য সবসময় খসড়া হিসেবে শুরু হয়।'
              : 'A new product always starts as a draft.'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <ProductEditor lang={lang} product={null} options={options} />
      )}
    </>
  );
}
