/**
 * Landing pages — `/admin/landing` (Phase 10 pass J).
 *
 * Server component: fetches the page list and hands it to the island. The public
 * GET and the public order POST already exist; the storefront page that would call
 * them is a frontend phase, and this screen does not pretend otherwise.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import { LandingScreen } from '@/components/admin/landing-screen';

export const metadata: Metadata = {
  title: 'Landing pages',
  robots: { index: false, follow: false },
};

interface LandingItem {
  id: string;
  slug: string;
  title: string;
  campaignName: string | null;
  productId: string | null;
  productName: string | null;
  isActive: boolean;
  orderCount: number;
  createdAt: string;
}

export default async function LandingPage() {
  const lang = await getLang();

  let items: LandingItem[] = [];
  let error: string | null = null;

  try {
    const response = await adminFetchServer<{ items: LandingItem[] }>('/admin/landing');
    items = response.data.items;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'ল্যান্ডিং পেজ লোড করা যায়নি।'
          : 'Could not load landing pages.';
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'ল্যান্ডিং পেজ' : 'Landing pages'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${items.length}টি ক্যাম্পেইন পেজ · এক পেজ, এক পণ্য`
              : `${items.length} campaign pages · one page, one product`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <LandingScreen lang={lang} items={items} />
      )}
    </>
  );
}
