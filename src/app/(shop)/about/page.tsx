import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { fetchStoreProfile } from '@/lib/api/public-settings';
import { getLang } from '@/lib/locale';
import { DocPage } from '@/components/legal/doc-page';
import { aboutContent } from '@/lib/legal/content';

/**
 * `/about` — the fifth dead footer link.
 *
 * Not one of the four legal pages, but the footer's Company column links here and
 * a 404 in the footer is the kind of thing a customer clicks while deciding
 * whether to trust a shop. Two minutes of copy is cheaper than the doubt.
 */

export const metadata: Metadata = {
  title: 'About us',
  description: `Who ${BRAND.name} is, what the shop sells, and what it promises.`,
  alternates: { canonical: '/about' },
  robots: { index: true, follow: true },
};

export default async function AboutPage() {
  const [lang, store] = await Promise.all([getLang(), fetchStoreProfile()]);

  return <DocPage content={aboutContent(lang, store)} lang={lang} current="about" />;
}
