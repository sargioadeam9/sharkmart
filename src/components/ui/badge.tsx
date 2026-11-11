/**
 * Badge — the reference's `.badge` (discount pill) plus the status pills the
 * admin and the product page need. Storefront only in this phase.
 *
 * The discount pill is positioned absolutely in the reference (over the product
 * image). `absolute` is opt-in here so the same component can be used inline in
 * a spec table.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'discount'
  | 'new'
  | 'sale'
  | 'bestseller'
  | 'trending'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Absolutely positioned over an image, as the reference does. */
  overlay?: boolean;
  className?: string;
  children: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  discount: 'bg-shop-red text-white',
  new: 'bg-shop-navy text-white',
  sale: 'bg-shop-red text-white',
  bestseller: 'bg-[#a15c00] text-white',
  trending: 'bg-shop-ok text-white',
  neutral: 'bg-shop-line text-shop-navy',
  success: 'bg-shop-ok text-white',
  warning: 'bg-[#a15c00] text-white',
  danger: 'bg-shop-red text-white',
};

export function Badge({
  tone = 'discount',
  overlay = false,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-[9px] py-[3px] text-[12px] font-extrabold leading-[1.4]',
        TONE_CLASS[tone],
        overlay && 'absolute left-[10px] top-[10px] z-[2]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The reference's count badge — `.cnt`, used on the cart and wishlist icons. */
export interface CountBadgeProps {
  count: number;
  /** Plays the bump animation when the count changes. */
  bump?: boolean;
  className?: string;
}

export function CountBadge({ count, bump = false, className }: CountBadgeProps) {
  if (count <= 0) return null;

  return (
    <b
      className={cn(
        'absolute right-[6px] top-0 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-white bg-shop-red px-[5px] text-[11px] font-bold text-white',
        bump && 'animate-[sm-bump_0.5s]',
        className,
      )}
      aria-hidden="true"
    >
      {count > 99 ? '99+' : count}
    </b>
  );
}
