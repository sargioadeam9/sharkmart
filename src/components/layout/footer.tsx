/**
 * Footer — the reference's `footer` (oshoppingbd.html L238-247, markup L625).
 *
 * Five columns: brand + payment chips, Customer Care, Shop (first 5 categories),
 * Company, Contact. Plus a copyright row.
 *
 * Two things that are easy to miss:
 * - The brand paragraph is a long bilingual sentence, not a tagline. It lives
 *   in the i18n dictionary (`footAbout`), not inline.
 * - `footer { padding-bottom: 70px }` below 760px so the fixed bottom nav does
 *   not cover the copyright row. That is a Phase 2 gate item.
 */

'use client';

import Link from 'next/link';

import type { CategoryDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { useLang } from '@/lib/hooks';
import { BRAND } from '@/lib/brand';
import { Logo } from '@/components/brand/logo';

export interface FooterProps {
  categories: CategoryDto[];
}

const PAYMENT_METHODS = ['COD', 'bKash', 'Nagad', 'Visa', 'Mastercard'];

export function Footer({ categories }: FooterProps) {
  const { lang, t } = useLang();

  const shopCategories = categories.slice(0, 5);

  return (
    <footer>
      <div className="wrap">
        <div className="fg">
          <div>
            <Logo href="/" size="md" />
            <p>
              {lang === 'bn'
                ? 'বাংলাদেশের নির্ভরযোগ্য মাল্টি-ক্যাটাগরি অনলাইন শপ। সব পণ্য এক ঠিকানায়।'
                : "Bangladesh's trusted multi-category online shop. Everything you need, one address."}
            </p>
            <div className="pay">
              {PAYMENT_METHODS.map((method) => (
                <span key={method}>{method}</span>
              ))}
            </div>
          </div>

          <div>
            <h4>{lang === 'bn' ? 'কাস্টমার কেয়ার' : 'Customer Care'}</h4>
            <ul>
              <li>
                <Link href="/help">{t('help')}</Link>
              </li>
              <li>
                <Link href="/track">{t('track')}</Link>
              </li>
              <li>
                <Link href="/return">{t('ret')}</Link>
              </li>
              <li>
                <Link href="/help">FAQ</Link>
              </li>
            </ul>
          </div>

          <div>
            <h4>{lang === 'bn' ? 'শপ' : 'Shop'}</h4>
            <ul>
              {shopCategories.map((category) => (
                <li key={category.id}>
                  <Link href={`/category/${category.slug}`}>
                    {localized(lang, category.nameEn, category.nameBn)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>{lang === 'bn' ? 'কোম্পানি' : 'Company'}</h4>
            <ul>
              <li>
                <Link href="/about">About us</Link>
              </li>
              <li>
                <Link href="/terms">Terms &amp; Conditions</Link>
              </li>
              <li>
                <Link href="/privacy">Privacy Policy</Link>
              </li>
              <li>
                <Link href="/return">Return Policy</Link>
              </li>
            </ul>
          </div>

          <div>
            <h4>{lang === 'bn' ? 'যোগাযোগ' : 'Contact'}</h4>
            <ul>
              <li>📞 {BRAND.phone}</li>
              <li>✉️ {BRAND.supportEmail}</li>
              <li>📍 {lang === 'bn' ? 'ঢাকা, বাংলাদেশ' : BRAND.address}</li>
            </ul>
          </div>
        </div>

        <div className="copy">
          <span>
            © 2026 {BRAND.name}. All rights reserved.
          </span>
          <span>{BRAND.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
