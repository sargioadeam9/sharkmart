/**
 * Session store.
 *
 * Holds the current user in memory only. The credential itself is an HttpOnly
 * cookie the JavaScript cannot read (AGENTS.md §7.5) — this store is a cache of
 * "who am I" for rendering, never a token.
 *
 * Why not persist it: a persisted user blob would paint the signed-in header on
 * a cold load before the cookie was validated, so a user whose session had
 * expired would see their name and then get bounced. `status: 'unknown'` is
 * honest — the header renders its signed-out state until `/me` answers.
 */

'use client';

import { create } from 'zustand';
import type { PublicUser } from '@/types/account';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

interface SessionState {
  user: PublicUser | null;
  status: SessionStatus;

  /** Called once `/me` resolves. */
  setUser: (user: PublicUser | null) => void;
  /** Optimistic set after a successful login/register. */
  signIn: (user: PublicUser) => void;
  /** After logout or a failed refresh. */
  signOut: () => void;
  /** Re-read the cookie-backed session. */
  reload: () => Promise<void>;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  user: null,
  status: 'unknown',

  setUser: (user) =>
    set({ user, status: user ? 'authenticated' : 'anonymous' }),

  signIn: (user) => set({ user, status: 'authenticated' }),

  signOut: () => set({ user: null, status: 'anonymous' }),

  reload: async () => {
    // Imported lazily so this module stays importable during SSR prerender,
    // where `document` (and therefore the CSRF cookie read) does not exist.
    const { getMe } = await import('@/lib/api/account');
    try {
      const user = await getMe();
      set({ user, status: user ? 'authenticated' : 'anonymous' });
    } catch {
      // A transport failure must not claim the user is signed out — that would
      // log them out of the UI over a network blip. Leave the status as it was.
      if (get().status === 'unknown') set({ status: 'anonymous' });
    }
  },
}));
