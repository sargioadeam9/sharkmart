/**
 * DocumentLanguage — keeps `<html lang>` and `<body class="bn">` in sync with
 * the UI store's language.
 *
 * Why this exists: the store is the single source of truth for language, but
 * the two places that matter to the browser are outside React —
 *
 *   - `<html lang>` for assistive tech and hyphenation
 *   - `body.bn`, which is what swaps the font stack to Hind Siliguri and lifts
 *     Bangla heading line-height to 1.25 (globals.css `@layer base`)
 *
 * Without this, switching to Bangla translated every string but left the body
 * in the Latin stack — Bangla glyphs are wider and taller, so headings collide
 * (AGENTS.md landmine #6). The reference does exactly this in its language
 * handler (`document.documentElement.lang`, `document.body.className`).
 *
 * Renders nothing. Mounted once in the storefront shell.
 */

'use client';

import { useEffect } from 'react';

import { useLang } from '@/lib/hooks';
import { bodyClass, htmlLang } from '@/lib/i18n';

export function DocumentLanguage() {
  const { lang } = useLang();

  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);

    // `bodyClass` is the single source of truth for the class name; it returns
    // '' for English, which removes the class.
    document.body.className = bodyClass(lang);
  }, [lang]);

  return null;
}
