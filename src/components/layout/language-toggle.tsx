/**
 * LanguageToggle — the reference's `langSw()` (oshoppingbd.html line 632).
 *
 * Two pills, EN and বাংলা, in a rounded track. The active one is filled.
 *
 * The reference re-renders the whole document on switch. Here the language
 * lives in the UI store, so every component that calls `useLang()` re-renders
 * by itself — no reload, no re-render of the shell.
 *
 * `variant` exists because the mobile header re-skins the same control
 * (oshoppingbd.html L470: pink track, red active pill instead of white).
 */

'use client';

import { useLang } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from '@/lib/locale-cookie';
import type { Lang } from '@/lib/format';

export interface LanguageToggleProps {
  variant?: 'topbar' | 'mobile';
  className?: string;
}

const OPTIONS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'bn', label: 'বাংলা' },
];

/**
 * Writes the language cookie.
 *
 * Module scope, not inline in the handler: the lint rule (correctly) refuses a
 * `document.cookie` assignment inside a component body, because that is a write
 * to something outside React's control during render. As a plain function it is
 * an ordinary side effect, called from an event handler, which is where it
 * belongs.
 */
function writeLangCookie(value: Lang): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LANG_COOKIE}=${value}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
}

export function LanguageToggle({
  variant = 'topbar',
  className,
}: LanguageToggleProps) {
  const { lang, setLang } = useLang();

  /**
   * Persist the choice server-side as well as in the store.
   *
   * The store is what makes the switch instant and survives a refresh; the
   * cookie is what lets a server component know the language before the first
   * paint. `samesite=lax` matches the session cookie policy in
   * `prompts/security.md` section 4 and still sends on top-level navigation.
   *
   * `document.cookie` is written directly rather than through `cookies()`:
   * this is a client component, and a server action for a one-line preference
   * would cost a round trip on every toggle.
   */
  const choose = (value: Lang) => {
    setLang(value);
    writeLangCookie(value);
  };

  return (
    <span
      className={cn('lang', className)}
      role="group"
      aria-label="Language"
      data-variant={variant}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => choose(option.value)}
          className={cn(lang === option.value && 'on')}
          aria-pressed={lang === option.value}
          lang={option.value}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}
