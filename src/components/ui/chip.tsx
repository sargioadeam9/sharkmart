'use client';

/**
 * Chip — the reference's `.chip` (oshoppingbd.html L306-307), used for filter
 * pills and category shortcuts.
 *
 * The accent colour arrives as data (`--a`), which is the one place a raw hex
 * is legitimate: it comes from the category record, not from a design decision.
 */

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Category accent hex. Falls back to the line token. */
  accent?: string;
  children: React.ReactNode;
}

export function Chip({
  selected = false,
  accent,
  className,
  children,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn('chip', selected && 'on', className)}
      style={accent ? { ['--a' as string]: accent } : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
