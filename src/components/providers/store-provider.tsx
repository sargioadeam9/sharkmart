'use client';

/**
 * The store profile, available to every client component under the storefront.
 *
 * The values are fetched once by `(shop)/layout.tsx` (a server component) and
 * passed down, so no client component triggers a request and nothing flashes a
 * stale fee before correcting itself.
 *
 * `useStore()` always returns a complete object: the provider's default is
 * `FALLBACK_STORE`, which mirrors the constants the storefront used before this
 * module existed. A missing provider therefore renders exactly what the site
 * rendered yesterday, not a broken header.
 */

import { createContext, useContext, type ReactNode } from 'react';

import { FALLBACK_STORE, type StoreProfile } from '@/lib/api/public-settings';

const StoreContext = createContext<StoreProfile>(FALLBACK_STORE);

export function StoreProvider({
  value,
  children,
}: {
  value: StoreProfile;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** The store profile. Never undefined — see the fallback note above. */
export function useStore(): StoreProfile {
  return useContext(StoreContext);
}
