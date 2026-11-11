import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BRAND } from '@/lib/brand';
import { MOCK_PRODUCTS } from '@/lib/mock';
import { loadProductPageData, type ProductPageData } from '@/lib/product-data';
import { ProductPage } from '@/components/product/product-page';

/**
 * `/product/[slug]` — the product detail page.
 *
 * Same shape as `/category/[slug]`: the slug is validated before anything
 * renders, the data is loaded on the server and handed to the client component
 * as props, and `generateStaticParams` prerenders the catalog so a bad slug
 * fails the build instead of shipping a 404.
 *
 * The slug is the lowercased SKU (`prd_osb-1001` → `osb-1001`), which is what
 * `MOCK_PRODUCTS` and the future API both key on.
 *
 * What this route deliberately does NOT do: it does not call `getLang()`.
 * `cookies()` in a page or layout forces the whole route dynamic and undoes the
 * static prerender from 977153b. The language seam exists and is ready; wiring
 * it in is a routing decision (real `/bn` paths), not a detail page decision.
 */

export const revalidate = 300;

export function generateStaticParams(): { slug: string }[] {
  return MOCK_PRODUCTS.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = MOCK_PRODUCTS.find((p) => p.slug === slug);

  if (!product) {
    return { title: 'Not found' };
  }

  // The root layout's template appends "| SharkMart", so the brand is not
  // repeated here.
  const title = product.nameEn;
  const description =
    product.descriptionEn ??
    `Buy ${product.nameEn} at ${BRAND.name}. Cash on Delivery across Bangladesh, easy returns and free delivery over ৳2,000.`;

  const image = product.images.find((i) => i.isMain) ?? product.images[0];

  return {
    title,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: `${title} — ${BRAND.name}`,
      description,
      type: 'website',
      ...(image ? { images: [{ url: image.url, alt: image.altEn }] } : {}),
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const exists = MOCK_PRODUCTS.some((p) => p.slug === slug);
  if (!exists) {
    notFound();
  }

  /**
   * A data failure must not 500 the page. Same rule as the category route: if
   * the load throws, render the 404 boundary rather than a stack trace. There is
   * no useful half-page for a product detail — the whole page is the product.
   */
  let data: ProductPageData;
  try {
    data = await loadProductPageData(slug);
  } catch {
    notFound();
  }

  return <ProductPage product={data.product} rails={data.rails} />;
}
