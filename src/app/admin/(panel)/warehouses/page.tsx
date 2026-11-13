/**
 * Warehouses — `/admin/warehouses` (Phase 10 pass E).
 *
 * Server component: fetches the list and the recent transfers, then hands both to
 * the client island. Everything that writes lives in the island.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type { TransferItem, WarehouseItem } from '@/lib/api/admin-warehouses';
import { WarehousesScreen } from '@/components/admin/warehouses-screen';

export const metadata: Metadata = {
  title: 'Warehouses',
  robots: { index: false, follow: false },
};

export default async function WarehousesPage() {
  const lang = await getLang();

  let warehouses: WarehouseItem[] = [];
  let transfers: TransferItem[] = [];
  let error: string | null = null;

  try {
    const [list, moves] = await Promise.all([
      adminFetchServer<{ warehouses: WarehouseItem[] }>('/admin/warehouses'),
      adminFetchServer<{ items: TransferItem[] }>('/admin/warehouses/transfers?page=1&limit=10'),
    ]);
    warehouses = list.data.warehouses;
    transfers = moves.data.items;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'গুদাম লোড করা যায়নি।'
          : 'Could not load warehouses.';
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'গুদাম' : 'Warehouses'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${warehouses.length}টি গুদাম · স্টকের অবস্থান ও ট্রান্সফার`
              : `${warehouses.length} locations · where stock sits, and moving it`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <WarehousesScreen lang={lang} warehouses={warehouses} transfers={transfers} />
      )}
    </>
  );
}
