import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CATEGORIES, getCategory } from '@/lib/categories';
import { BRAND } from '@/lib/brand';
import { loadCategoryData, type CategoryData } from '@/lib/category-data';
import { CategoryPage } from '@/components/category/category-page';

/**
 * `/category/[slug]` — the 14 category landing pages.
 *
 * One route, one template, fourteen instances. The slug is validated against
 * the `CATEGORIES` record (copied from the reference's `CATS` array) before
 * anything renders, so an unknown slug calls `notFound()` and Next renders the
 * 404 boundary instead of this component throwing on a missing record.
 *
 * `generateStaticParams` prerenders all fourteen at build time. That is the
 * whole point of a volume phase: the build proves every slug resolves, and a
 * typo in the category list fails `npm run build` rather than shipping a 404.
 *
 * The page also loads its data here, on the server, and hands it to the client
 * component as `initialData`. That is what puts the hero, the rails and the
 * product grid into the first HTML response — without it the server emitted a
 * skeleton and the crawler saw an empty page.
 */

export const revalidate = 300;

export function generateStaticParams(): { slug: string }[] {
  return CATEGORIES.map((category) => ({ slug: category.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategory(slug);

  if (!category) {
    return { title: 'Not found' };
  }

  // The root layout's template appends "| SharkMart", so the title here must
  // NOT repeat the brand or it renders as "Fashion — SharkMart | SharkMart".
  const title = category.nameEn;
  const description = `Shop ${category.nameEn.toLowerCase()} at ${BRAND.name}. Cash on Delivery across Bangladesh, easy returns and free delivery over ৳2,000.`;

  return {
    title,
    description,
    alternates: { canonical: `/category/${category.id}` },
    openGraph: { title: `${title} — ${BRAND.name}`, description, type: 'website' },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!getCategory(slug)) {
    notFound();
  }

  /**
   * A data failure must not take the page down: if the load throws (API down,
   * bad payload) we render without `initialData` and the client component falls
   * back to its own fetch, which shows the error state instead of a 500.
   */
  let initialData: CategoryData | undefined;
  try {
    initialData = await loadCategoryData(slug);
  } catch {
    initialData = undefined;
  }

  return <CategoryPage slug={slug} initialData={initialData} />;
}
