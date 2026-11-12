/**
 * `/profile` — the account overview.
 *
 * Shows the profile form and the two things a signed-in shopper actually comes
 * here for: their orders and their addresses. The sidebar links are the whole
 * navigation; there is no separate "dashboard" page because a shopper with one
 * order does not need a dashboard.
 */

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PublicUser } from '@/types/account';
import { useLang } from '@/lib/hooks';
import { useSessionStore } from '@/lib/store/session-store';
import { updateProfile, logout } from '@/lib/api/account';
import { isValidBdPhone, normaliseBdPhone, required } from '@/lib/account-validation';
import { toast } from '@/components/shared/toast';
import { Field, FormAlert } from '@/components/account/form-fields';
import { AccountNav } from '@/components/account/account-nav';

export function ProfilePage() {
  const { tu } = useLang();
  const router = useRouter();

  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const signOut = useSessionStore((s) => s.signOut);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Seed the form from the session.
   *
   * Keyed on the user id, not the whole object: `setUser` after a save returns
   * a new object, and re-seeding on every object identity change would wipe
   * whatever the shopper had typed since.
   *
   * Adjusted during render rather than in an effect — React's documented
   * "adjust state when a prop changes" pattern. An effect would paint one frame
   * of empty inputs before the seed lands, and it is exactly the cascading
   * render `react-hooks/set-state-in-effect` exists to prevent.
   */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (user && seededFor !== user.id) {
    setSeededFor(user.id);
    setName(user.name);
    setPhone(user.phone ?? '');
  }

  const handleSave = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      const next: { name?: string; phone?: string } = {};
      if (!required(name)) next.name = tu('fullName');
      if (phone.trim() && !isValidBdPhone(phone)) next.phone = tu('invalidPhone');

      setErrors(next);
      if (Object.keys(next).length > 0) return;

      setSaving(true);
      try {
        const updated: PublicUser = await updateProfile({
          name: name.trim(),
          ...(phone.trim() ? { phone: normaliseBdPhone(phone) } : {}),
        });
        setUser(updated);
        toast(tu('saved'));
      } catch {
        setFormError(tu('genericAuthError'));
      } finally {
        setSaving(false);
      }
    },
    [name, phone, setUser, tu],
  );

  const handleSignOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // A failed logout still clears the local session: the cookie may already
      // be gone, and leaving the UI signed in is the worse outcome.
    }
    signOut();
    router.push('/');
  }, [signOut, router]);

  if (!user) return null;

  return (
    <div className="wrap acct-page">
      <div className="acct-head">
        <h1>{tu('profile')}</h1>
        <p>{user.email}</p>
      </div>

      <div className="acct-split">
        <div>
          <div className="acct-panel">
            <div className="acct-panel-head">
              <h2>{tu('accountOverview')}</h2>
            </div>
            <div className="acct-panel-body">
              <form className="acct-form" onSubmit={handleSave} noValidate>
                {formError && <FormAlert tone="error">{formError}</FormAlert>}

                <Field
                  label={tu('fullName')}
                  value={name}
                  onChange={setName}
                  autoComplete="name"
                  error={errors.name}
                  required
                />

                <Field
                  label={tu('email')}
                  value={user.email}
                  onChange={() => undefined}
                  type="email"
                  disabled
                  hint="Your email is used to sign in and cannot be changed here."
                />

                <Field
                  label={tu('phone')}
                  value={phone}
                  onChange={setPhone}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="01712345678"
                  hint={tu('phoneHint')}
                  error={errors.phone}
                />

                <button type="submit" className="btn red acct-submit" disabled={saving}>
                  {saving ? tu('loading') : tu('saveChanges')}
                </button>
              </form>
            </div>
          </div>

          <div className="acct-panel">
            <div className="acct-panel-head">
              <h2>{tu('signOut')}</h2>
            </div>
            <div className="acct-panel-body">
              <p className="acct-muted">
                Signing out ends this session on this device.
              </p>
              <div className="acct-actions">
                <button type="button" className="btn line" onClick={() => void handleSignOut()}>
                  {tu('signOut')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="acct-aside">
          <AccountNav active="profile" />
        </aside>
      </div>
    </div>
  );
}
