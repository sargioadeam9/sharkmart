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
import type { Lang } from '@/lib/format';

export interface LanguageToggleProps {
  variant?: 'topbar' | 'mobile';
  className?: string;
}

const OPTIONS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'bn', label: 'বাংলা' },
];

export function LanguageToggle({
  variant = 'topbar',
  className,
}: LanguageToggleProps) {
  const { lang, setLang } = useLang();

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
          onClick={() => setLang(option.value)}
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
