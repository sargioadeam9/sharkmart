import type { Metadata } from 'next';

import { HomePage } from '@/components/home/home-page';
import { BRAND } from '@/lib/brand';

/**
 * The storefront homepage — route `/`.
 *
 * Reference: `home()` in oshoppingbd.html (L654-673), rendered section for
 * section by `<HomePage />`.
 *
 * Metadata lives here (server-side, where Next wants it) while the sections are
 * client components so the language toggle reaches them. The Phase 0 proof page
 * that used to occupy this route now lives at `/dev/components`.
 */

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description:
    'Shop fashion, gadgets, beauty, groceries and more across Bangladesh. Cash on Delivery, easy returns and free delivery over ৳2,000.',
  alternates: { canonical: '/' },
};

export default function Page() {
  return <HomePage />;
}
