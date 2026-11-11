import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CATEGORIES, getCategory } from '@/lib/categories';
import { BRAND } from '@/lib/brand';
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
 */

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

  return <CategoryPage slug={slug} />;
}
