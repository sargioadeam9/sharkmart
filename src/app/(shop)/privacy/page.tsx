import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { fetchStoreProfile } from '@/lib/api/public-settings';
import { getLang } from '@/lib/locale';
import { DocPage } from '@/components/legal/doc-page';
import { privacyContent } from '@/lib/legal/content';

/**
 * `/privacy` — what the shop collects and why.
 *
 * The claims here are deliberately checkable against the code: passwords are
 * hashed (bcrypt), the session cookie is `httpOnly`, and no card number is ever
 * stored — `Order` holds a gateway transaction id and nothing else. A privacy
 * page that describes a system the code does not implement is a liability, not
 * paperwork.
 */

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: `What ${BRAND.name} collects, why, who it is shared with, and how to have it removed.`,
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};

export default async function PrivacyPage() {
  const [lang, store] = await Promise.all([getLang(), fetchStoreProfile()]);

  return <DocPage content={privacyContent(lang, store)} lang={lang} current="privacy" />;
}
