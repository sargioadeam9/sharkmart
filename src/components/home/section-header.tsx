/**
 * SectionHeader — the reference's `head(h, sub, link)`
 * (oshoppingbd.html L647, CSS L124-136).
 *
 * The red bar before the title is a `::before` in the reference and stays one
 * here; it is decoration, not content, so it never reaches the accessibility
 * tree. The "View all" link is only rendered when a href is given, exactly as
 * the reference does.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: string;
  /** Omit to render no "View all" link. */
  viewAllHref?: string;
  viewAllLabel?: string;
  /** Extra content on the right, e.g. the flash-sale countdown. */
  aside?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  viewAllHref,
  viewAllLabel,
  aside,
  className,
}: SectionHeaderProps) {
  return (
    <div className={className ? `sh ${className}` : 'sh'}>
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>

      {aside}

      {viewAllHref ? (
        <Link className="va" href={viewAllHref}>
          {viewAllLabel} →
        </Link>
      ) : null}
    </div>
  );
}
