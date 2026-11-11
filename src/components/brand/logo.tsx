import Image from 'next/image';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

type LogoSize = 'sm' | 'md' | 'lg';

const HEIGHTS: Record<LogoSize, number> = {
  sm: 34, // mobile header — reference .mhd .logo .mk is 34px
  md: 40, // desktop header — reference .logo .mk is 40px
  lg: 56,
};

export interface LogoProps {
  /** Wrap in a link. Pass `null` to render a bare image. */
  href?: string | null;
  size?: LogoSize;
  /** Set on the header logo only — above-the-fold. */
  priority?: boolean;
  className?: string;
}

/**
 * SharkMart lockup.
 *
 * Uses the real brand asset, which already carries the two-colour wordmark
 * (Shark navy / Mart red) and the shark-bag mark. One implementation, reused
 * by the storefront header, footer, mobile header and the admin sidebar.
 */
export function Logo({
  href = '/',
  size = 'md',
  priority = false,
  className,
}: LogoProps) {
  const height = HEIGHTS[size];
  const width = Math.round((height * BRAND.logo.width) / BRAND.logo.height);

  const image = (
    <Image
      src={BRAND.logo.src}
      alt={href ? '' : BRAND.logo.alt}
      width={width}
      height={height}
      priority={priority}
      className="block h-auto w-auto"
      style={{ height, width: 'auto' }}
    />
  );

  if (!href) {
    return <span className={className}>{image}</span>;
  }

  return (
    <Link
      href={href}
      aria-label={`${BRAND.name} home`}
      className={`inline-flex shrink-0 items-center ${className ?? ''}`}
    >
      {image}
    </Link>
  );
}
