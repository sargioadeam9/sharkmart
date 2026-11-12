/**
 * Edit product — `/admin/products/[id]`.
 *
 * Fetches the full detail (images, variants, specs, details, SEO) and hands it to
 * the same editor the create route renders. A 404 from the API becomes a plain
 * "not found" card rather than an error page, because a stale link to a deleted
 * product is a normal thing to click.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type { AdminProductDetail, ProductFormOptions } from '@/lib/api/admin-products';
import { ProductEditor } from '@/components/admin/product-editor';

export const metadata: Metadata = {
  title: 'Edit product',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
  const lang = await getLang();
  const { id } = await params;

  let product: AdminProductDetail;
  let options: ProductFormOptions = { categories: [], brands: [] };

  try {
    const [detail, formOptions] = await Promise.all([
      adminFetchServer<AdminProductDetail>(`/admin/products/${id}`),
      adminFetchServer<ProductFormOptions>('/admin/products/form-options'),
    ]);
    product = detail.data;
    options = formOptions.data;
  } catch (caught) {
    if (caught instanceof AdminApiError && caught.status === 404) notFound();
    throw caught;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <Link href="/admin/products" className="editor-back">
            <ArrowLeft size={14} aria-hidden />
            {lang === 'bn' ? 'পণ্যে ফিরুন' : 'Back to products'}
          </Link>
          <h1>{lang === 'bn' ? product.nameBn : product.nameEn}</h1>
          <p className="sub">
            <code className="prod-sku">{product.sku}</code>
            {' · '}
            {lang === 'bn' ? product.categoryNameBn : product.categoryNameEn}
          </p>
        </div>
      </div>

      <ProductEditor lang={lang} product={product} options={options} />
    </>
  );
}
