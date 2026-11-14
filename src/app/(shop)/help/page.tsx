import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { fetchStoreProfile } from '@/lib/api/public-settings';
import { getLang } from '@/lib/locale';
import { DocPage } from '@/components/legal/doc-page';
import { helpContent } from '@/lib/legal/content';

/**
 * `/help` — the page the footer's "Help & Support" and "FAQ" links both point at.
 *
 * Server component: prose, no session, no client state. The delivery figures on
 * it come from `fetchStoreProfile()`, the same object checkout charges from, so
 * the fee quoted here cannot drift from the fee charged there.
 *
 * `index: true` — unlike an account page, this is exactly the kind of page a
 * search engine should surface ("sharkmart delivery charge", "how to track").
 */

export const metadata: Metadata = {
  title: 'Help & support',
  description: `Order tracking, delivery charges, payment methods and account help for ${BRAND.name}.`,
  alternates: { canonical: '/help' },
  robots: { index: true, follow: true },
};

export default async function HelpPage() {
  const [lang, store] = await Promise.all([getLang(), fetchStoreProfile()]);

  return <DocPage content={helpContent(lang, store)} lang={lang} current="help" />;
}
