/**
 * Homepage aggregate — one call for the whole Phase 3 page.
 *
 * The reference's homepage needs flash sale, featured, new arrivals, best
 * sellers, trending, all categories and both brand rails. Fetching those as
 * seven requests would be seven round trips on a 3G connection; the backend
 * spec already calls for a homepage aggregate endpoint, so the contract is
 * frozen here in Phase 0.
 */

import type { ApiSuccess } from '@/types/api';
import { resolve } from './client';
import { mockHomepage, type HomepageAggregate } from '@/lib/mock';

export type { HomepageAggregate };

export function getHomepage(): Promise<ApiSuccess<HomepageAggregate>> {
  return resolve('/homepage', mockHomepage);
}
