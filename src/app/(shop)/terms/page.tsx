import type { Metadata } from 'next';

import { BRAND } from '@/lib/brand';
import { fetchStoreProfile } from '@/lib/api/public-settings';
import { getLang } from '@/lib/locale';
import { DocPage } from '@/components/legal/doc-page';
import { termsContent } from '@/lib/legal/content';

/**
 * `/terms` — the terms of sale.
 *
 * Governing law is Bangladesh and the courts of Dhaka, which is what a Bangladeshi
 * shop's terms actually say; a US-style arbitration clause copied into a Dhaka
 * shop's footer is unenforceable and reads as boilerplate.
 */

export const metadata: Metadata = {
  title: 'Terms & conditions',
  description: `The terms you agree to when you order from ${BRAND.name}: orders, pricing, delivery, returns and liability.`,
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

export default async function TermsPage() {
  const [lang, store] = await Promise.all([getLang(), fetchStoreProfile()]);

  return <DocPage content={termsContent(lang, store)} lang={lang} current="terms" />;
}
