import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { fetchStoreProfile } from '@/lib/api/public-settings';
import { getLang } from '@/lib/locale';
import { DocPage } from '@/components/legal/doc-page';
import { returnContent } from '@/lib/legal/content';

/**
 * `/return` — the return and refund policy.
 *
 * Linked from the footer twice (Customer Care and Company), from the top bar and
 * from `/help`. The 7-day window and the 5–7 working day refund are the shop's
 * stated policy and live in `src/lib/legal/content.ts` — one place to edit, not
 * five pages to hunt through.
 */

export const metadata: Metadata = {
  title: 'Return & refund policy',
  description: `How to return an item, what is eligible, and when a refund reaches you at ${BRAND.name}.`,
  alternates: { canonical: '/return' },
  robots: { index: true, follow: true },
};

export default async function ReturnPage() {
  const [lang, store] = await Promise.all([getLang(), fetchStoreProfile()]);

  return <DocPage content={returnContent(lang, store)} lang={lang} current="return" />;
}
