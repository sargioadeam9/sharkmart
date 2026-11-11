import type { Metadata } from 'next';

import { HomePage } from '@/components/home/home-page';
import { getHomepage, type HomepageAggregate } from '@/lib/api/homepage';
import { BRAND } from '@/lib/brand';

/**
 * The storefront homepage — route `/`.
 *
 * Reference: `home()` in oshoppingbd.html (L654-673), rendered section for
 * section by `<HomePage />`.
 *
 * The data is loaded **here, on the server**, and passed down as
 * `initialData`. The sections stay client components (the language toggle and
 * the carousels need it), but they no longer start from an empty skeleton:
 * every section is in the first HTML response, so the crawler sees real
 * content and there is no skeleton-to-content layout shift.
 *
 * A failed load does not 500 the page — `initialData` stays undefined and the
 * client component falls back to its own fetch and error state.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description:
    'Shop fashion, gadgets, beauty, groceries and more across Bangladesh. Cash on Delivery, easy returns and free delivery over ৳2,000.',
  alternates: { canonical: '/' },
};

export default async function Page() {
  let initialData: HomepageAggregate | undefined;

  try {
    initialData = (await getHomepage()).data;
  } catch {
    initialData = undefined;
  }

  return <HomePage initialData={initialData} />;
}
