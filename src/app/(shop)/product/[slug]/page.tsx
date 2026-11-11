import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BRAND } from '@/lib/brand';
import { ApiClientError } from '@/lib/api/client';
import { USE_MOCK } from '@/lib/api/config';
import { getProduct, listProductSlugs } from '@/lib/api/products';
import { absoluteUrl } from '@/lib/locale';
import { loadProductPageData, type ProductPageData } from '@/lib/product-data';
import type { ProductDetailDto, ProductDto } from '@/types/catalog';
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
 * the API keys on.
 *
 * Everything on this route goes through `src/lib/api/products.ts`. It used to
 * import `MOCK_PRODUCTS` for the slug list, the metadata and the existence
 * check — which would have kept serving fixtures for all three the moment
 * `USE_MOCK` flipped to false, while the page body came from the API.
 *
 * What this route deliberately does NOT do: it does not call `getLang()`.
 * `cookies()` in a page or layout forces the whole route dynamic and undoes the
 * static prerender from 977153b. The language seam exists and is ready; wiring
 * it in is a routing decision (real `/bn` paths), not a detail page decision.
 * The server therefore always emits English copy, and the JSON-LD below follows
 * the server render rather than the client's post-hydration language.
 */

export const revalidate = 300;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const response = await listProductSlugs();
  return response.data.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  let product: ProductDto;
  try {
    product = (await getProduct(slug)).data;
  } catch (error) {
    // A missing product is a missing page. Anything else is a data failure and
    // must not be reported to a crawler as "this product is gone".
    if (isNotFound(error)) return { title: 'Not found' };
    throw error;
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

  /**
   * Only a 404 is a 404.
   *
   * The previous `try { ... } catch { notFound() }` turned a five-second API
   * blip into a permanent-looking "this product no longer exists" for Google.
   * Now: a 404 renders the 404 boundary, and every other error rethrows — which
   * fails the build loudly at build time and, at runtime, leaves ISR serving
   * the last good page instead of replacing it with a 404.
   *
   * The existence check is gone with it: `loadProductPageData` already asks the
   * API for the product, so a second lookup for the same slug was a wasted
   * round trip that could disagree with the first.
   */
  let data: ProductPageData;
  try {
    data = await loadProductPageData(slug);
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }

  return (
    <>
      <ProductJsonLd product={data.product} />
      <ProductPage product={data.product} rails={data.rails} />
    </>
  );
}

/** A missing product, as opposed to a data failure. */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

/**
 * Absolute, crawlable image URL.
 *
 * The mock layer serves `data:image/svg+xml` placeholders, which are not valid
 * `Product.image` values and would be dropped by Google anyway. Those are
 * skipped; when nothing real is left the brand logo stands in, so the block
 * never ships an empty `image`. Real API URLs pass through untouched.
 */
function jsonLdImages(product: ProductDetailDto): string[] {
  const urls = product.images
    .map((image) => image.url)
    .filter((url) => url.startsWith('http://') || url.startsWith('https://'));

  return urls.length > 0 ? urls : [absoluteUrl(BRAND.logo.src)];
}

/**
 * The Product structured data block.
 *
 * Rendered by the server component so it is in the first HTML response — an
 * effect would be invisible to the crawler that needs it. Exactly one block per
 * page; BreadcrumbList belongs to Phase 11.
 *
 * `aggregateRating` is emitted only when there is a real rating behind it: a
 * rating with zero reviews is a rich-result violation, and Google penalises it.
 *
 * It is ALSO suppressed while `USE_MOCK` is on. The mock layer generates its
 * reviews (`buildReviews` in src/lib/mock/product-detail.ts), so publishing them
 * would tell Google that a product has hundreds of reviews it never received.
 * That is fabricated review markup, which Google treats as spam and can answer
 * with a manual action. Flip `USE_MOCK` to false and real ratings start flowing
 * through this same block with no further change.
 */
function ProductJsonLd({ product }: { product: ProductDetailDto }) {
  const canonical = absoluteUrl(`/product/${product.slug}`);

  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.nameEn,
    image: jsonLdImages(product),
    sku: product.sku,
    ...(product.brand
      ? { brand: { '@type': 'Brand', name: product.brand.nameEn } }
      : {}),
    ...(product.descriptionEn ? { description: product.descriptionEn } : {}),
    offers: {
      '@type': 'Offer',
      // Money is integer poisha everywhere; the wire format here is a decimal
      // string, which is what schema.org expects for `price`.
      price: (product.pricePoisha / 100).toFixed(2),
      priceCurrency: 'BDT',
      availability:
        product.stockStatus === 'out_of_stock'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      url: canonical,
    },
    // Suppressed in mock mode: those reviews are generated, not received.
    ...(!USE_MOCK && product.reviewCount > 0 && product.rating > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.rating.toFixed(1),
            reviewCount: product.reviewCount,
          },
        }
      : {}),
  };

  /**
   * `<` is escaped so a product name containing `</script>` cannot close the
   * tag and inject markup. `\u003c` is the same character to a JSON parser and
   * inert to the HTML parser, which is the whole point.
   */
  const serialized = JSON.stringify(json).replace(/</g, '\\u003c');

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialized }}
    />
  );
}
