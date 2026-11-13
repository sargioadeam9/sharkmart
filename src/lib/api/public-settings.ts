/**
 * The storefront's store profile and delivery rules, fetched once per render.
 *
 * ── Why a plain `fetch` and not `adminFetchServer` ─────────────────────────
 *
 * This endpoint is public: it carries the shop's name, contact details and the
 * three delivery numbers, and nothing a guest cannot already see. Using the admin
 * client would attach a session cookie and make the storefront layout dynamic for
 * every visitor.
 *
 * `next: { revalidate: 60 }` keeps the storefront static/ISR while picking up a
 * change within a minute. Five minutes was the first number and it was too long:
 * an operator who renames the shop and then refreshes the storefront should not
 * see the old name and conclude the save failed.
 *
 * ── The fallback ──────────────────────────────────────────────────────────
 *
 * If the API is unreachable the shop must still render. `FALLBACK` mirrors
 * `BRAND` and the reference's delivery rules, so a build with no API produces the
 * same page it produced before this module existed.
 */

import { BRAND } from '@/lib/brand';
import { FREE_DELIVERY_THRESHOLD_POISHA, STANDARD_DELIVERY_FEE_POISHA } from '@/lib/commerce';
import { API_BASE_URL, API_PREFIX } from './config';

export interface StoreProfile {
  name: string;
  tagline: string;
  domain: string;
  supportEmail: string;
  phone: string;
  address: string;
  nameFirst: string;
  nameSecond: string;
  logoUrl: string;
  delivery: {
    feePoisha: number;
    freeThresholdPoisha: number;
    expressSurchargePoisha: number;
  };
}

export const FALLBACK_STORE: StoreProfile = {
  name: BRAND.name,
  tagline: BRAND.tagline,
  domain: BRAND.domain,
  supportEmail: BRAND.supportEmail,
  phone: BRAND.phone,
  address: BRAND.address,
  nameFirst: BRAND.nameParts.first,
  nameSecond: BRAND.nameParts.second,
  logoUrl: BRAND.logo.src,
  delivery: {
    feePoisha: STANDARD_DELIVERY_FEE_POISHA,
    freeThresholdPoisha: FREE_DELIVERY_THRESHOLD_POISHA,
    expressSurchargePoisha: 10_000,
  },
};

/** Server-only. Called from the storefront layout. */
export async function fetchStoreProfile(): Promise<StoreProfile> {
  try {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}/settings`, {
      next: { revalidate: 60 },
      headers: { accept: 'application/json' },
    });

    if (!response.ok) return FALLBACK_STORE;

    const payload = (await response.json()) as { success?: boolean; data?: StoreProfile };
    if (!payload.success || !payload.data) return FALLBACK_STORE;

    // Merge over the fallback so a field the API does not send (an older
    // deployment, a partial response) cannot render `undefined` into the header.
    return {
      ...FALLBACK_STORE,
      ...payload.data,
      delivery: { ...FALLBACK_STORE.delivery, ...payload.data.delivery },
    };
  } catch {
    return FALLBACK_STORE;
  }
}
