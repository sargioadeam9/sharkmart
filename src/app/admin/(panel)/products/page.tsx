/**
 * Products list — `/admin/products`.
 *
 * A server component: it reads the query string, fetches once from
 * `GET /api/v1/admin/products`, and renders. No figure on this page is computed
 * in the browser — the stock badge, the payable price and the status all arrive
 * from the endpoint, because the admin and the storefront must agree and the
 * only way to guarantee that is one implementation, on the server.
 *
 * The interactive parts (search box, filter selects, bulk selection, the row
 * drawer) are one client island in `components/admin/products-table.tsx`.
 * Everything else is static markup.
 *
 * Filters live in the URL, not in component state. That means a filtered list
 * survives a refresh, can be bookmarked, and the back button does what the
 * operator expects. It also means the server does the filtering, which is the
 * only way `total` can be honest.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type {
  AdminProductListItem,
  AdminProductListResponse,
  ProductFormOptions,
} from '@/lib/api/admin-products';
import { ProductsToolbar, ProductsTable } from '@/components/admin/products-table';

export const metadata: Metadata = {
  title: 'Products',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Reads a single query value, ignoring the array form. */
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = one(params.q) ?? '';
  const status = (one(params.status) ?? 'all') as 'all' | 'published' | 'draft' | 'archived';
  const stock = (one(params.stock) ?? 'all') as 'all' | 'in' | 'low' | 'out';
  const categoryId = one(params.categoryId) ?? '';
  const brandId = one(params.brandId) ?? '';
  const sort = (one(params.sort) ?? 'updated') as
    | 'newest'
    | 'oldest'
    | 'name_asc'
    | 'name_desc'
    | 'price_asc'
    | 'price_desc'
    | 'updated';
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (status !== 'all') query.set('status', status);
  if (stock !== 'all') query.set('stock', stock);
  if (categoryId) query.set('categoryId', categoryId);
  if (brandId) query.set('brandId', brandId);
  if (sort !== 'updated') query.set('sort', sort);
  query.set('page', String(page));
  query.set('limit', String(limit));

  let data: AdminProductListResponse | null = null;
  let options: ProductFormOptions = { categories: [], brands: [] };
  let error: string | null = null;

  try {
    const [list, formOptions] = await Promise.all([
      adminFetchServer<AdminProductListResponse>(`/admin/products?${query.toString()}`),
      adminFetchServer<ProductFormOptions>('/admin/products/form-options'),
    ]);
    data = list.data;
    options = formOptions.data;
  } catch (caught) {
    if (caught instanceof AdminApiError) {
      error = caught.message;
    } else {
      error = lang === 'bn' ? 'পণ্য লোড করা যায়নি।' : 'Could not load products.';
    }
  }

  const items: AdminProductListItem[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  /** Preserves the current filters while changing one of them. */
  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/products?${next.toString()}`;
  }

  const TABS = [
    { key: 'all' as const, en: 'All', bn: 'সব' },
    { key: 'published' as const, en: 'Published', bn: 'প্রকাশিত' },
    { key: 'draft' as const, en: 'Draft', bn: 'খসড়া' },
    { key: 'archived' as const, en: 'Archived', bn: 'সংরক্ষিত' },
  ];

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'পণ্য' : 'Products'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${total}টি পণ্য · ${items.length}টি দেখানো হচ্ছে`
              : `${total} product${total === 1 ? '' : 's'} · showing ${items.length}`}
          </p>
        </div>
        <div className="actions">
          <Link href="/admin/products/new" className="btn">
            <Plus size={16} aria-hidden />
            {lang === 'bn' ? 'নতুন পণ্য' : 'New product'}
          </Link>
        </div>
      </div>

      {/* Status tabs. Each is a link, so the filter survives a refresh and the
          URL is shareable — no client state to lose. */}
      <div className="seg prod-tabs" role="tablist" aria-label={lang === 'bn' ? 'অবস্থা' : 'Status'}>
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={hrefWith({ status: tab.key === 'all' ? undefined : tab.key, page: undefined })}
            className={status === tab.key ? 'on' : undefined}
            role="tab"
            aria-selected={status === tab.key}
          >
            {lang === 'bn' ? tab.bn : tab.en}
          </Link>
        ))}
      </div>

      <ProductsToolbar
        lang={lang}
        initialQuery={q}
        status={status}
        stock={stock}
        categoryId={categoryId}
        brandId={brandId}
        sort={sort}
        categories={options.categories}
        brands={options.brands}
      />

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card prod-empty">
          <p>
            {lang === 'bn'
              ? 'কোনো পণ্য পাওয়া যায়নি। ফিল্টার বদলান বা নতুন পণ্য যোগ করুন।'
              : 'No products match. Change the filters, or add a new product.'}
          </p>
          <Link href="/admin/products/new" className="btn sm">
            {lang === 'bn' ? 'নতুন পণ্য' : 'New product'}
          </Link>
        </div>
      ) : (
        <ProductsTable
          lang={lang}
          items={items}
          total={total}
          page={page}
          totalPages={totalPages}
          prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
          nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
        />
      )}
    </>
  );
}
