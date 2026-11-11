/**
 * Skeletons — the reference has none, so these are ours. Built from the token
 * palette (line colour + a slightly warmer midpoint) so a loading card sits on
 * the same page background as a loaded one instead of flashing grey.
 *
 * Every skeleton is `aria-hidden` and the wrapper carries `aria-busy`, so a
 * screen reader hears "loading" once rather than a pile of empty boxes.
 */

import { cn } from '@/lib/utils';

export interface SkeletonProps {
  className?: string;
  /** Applied as inline width/height when the caller needs an exact size. */
  style?: React.CSSProperties;
}

export function Skeleton({ className, style }: SkeletonProps) {
  return <div className={cn('sk', className)} style={style} aria-hidden="true" />;
}

/** Matches `.pc` — image block, brand line, two title lines, price, button. */
export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('sk-card', className)} aria-hidden="true">
      <Skeleton className="sk-img" />
      <div className="sk-b">
        <Skeleton className="h-[9px] w-[45%]" />
        <Skeleton className="h-[11px] w-full" />
        <Skeleton className="h-[11px] w-[70%]" />
        <Skeleton className="mt-1 h-[13px] w-[55%]" />
        <Skeleton className="mt-2 h-[32px] w-full rounded-[11px]" />
      </div>
    </div>
  );
}

/** Matches `.bt` — logo block, name, tagline. */
export function BrandTileSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('sk-tile', className)} aria-hidden="true">
      <Skeleton className="h-[62px] w-full rounded-[14px]" />
      <Skeleton className="h-[11px] w-[60%]" />
      <Skeleton className="h-[9px] w-[40%]" />
    </div>
  );
}

/** Matches `.cc` — circular icon, name, count. */
export function CategoryCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('sk-tile', className)} aria-hidden="true">
      <Skeleton className="h-[74px] w-[74px] rounded-full" />
      <Skeleton className="h-[11px] w-[70%]" />
      <Skeleton className="h-[9px] w-[45%]" />
    </div>
  );
}

/** A list row — used by the cart drawer and any table-like surface. */
export function RowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('sk-row', className)} aria-hidden="true">
      <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-[14px]" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-[11px] w-[80%]" />
        <Skeleton className="h-[9px] w-[40%]" />
        <Skeleton className="h-[9px] w-[30%]" />
      </div>
    </div>
  );
}

/**
 * Wraps a set of skeletons with the accessible "loading" announcement.
 * `count` skeletons are rendered in a grid that matches the real content.
 */
export interface SkeletonGridProps {
  count?: number;
  variant?: 'product' | 'brand' | 'category' | 'row';
  label: string;
  className?: string;
}

export function SkeletonGrid({
  count = 5,
  variant = 'product',
  label,
  className,
}: SkeletonGridProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  return (
    <div
      className={cn('grid gap-4', className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only-focusable">{label}</span>
      {items.map((i) => {
        if (variant === 'brand') return <BrandTileSkeleton key={i} />;
        if (variant === 'category') return <CategoryCardSkeleton key={i} />;
        if (variant === 'row') return <RowSkeleton key={i} />;
        return <ProductCardSkeleton key={i} />;
      })}
    </div>
  );
}
