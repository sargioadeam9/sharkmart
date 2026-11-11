'use client';

/**
 * QuantityStepper — the reference's `.qty` (oshoppingbd.html L269-273) with the
 * `.pop` bump animation (L69).
 *
 * Behaviour that matters:
 *   - Decrementing to 0 removes the line (the caller decides; this component
 *     just reports 0 and lets the store drop it).
 *   - Never exceeds `max` (the line's stock), never goes below `min`.
 *   - The bump replays on every change: the key on the number forces a remount
 *     of the animated span, which is cheaper and more reliable than removing
 *     and re-adding a class in a timeout.
 */

import { useCallback } from 'react';
import { cn, clamp } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/hooks';

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Accessible names for the two buttons. */
  decreaseLabel: string;
  increaseLabel: string;
  /** Accessible name for the group, e.g. "Quantity". */
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  decreaseLabel,
  increaseLabel,
  label,
  size = 'md',
  disabled = false,
  className,
}: QuantityStepperProps) {
  const reducedMotion = usePrefersReducedMotion();

  const step = useCallback(
    (delta: number) => {
      const next = clamp(value + delta, min, max);
      if (next !== value) onChange(next);
    },
    [value, min, max, onChange],
  );

  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <div
      className={cn('qty', size === 'sm' && 'scale-90 origin-left', className)}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={disabled || atMin}
        aria-label={decreaseLabel}
      >
        −
      </button>

      {/* `key` on the value remounts the span on every change, which replays
          the .pop animation without a state variable or a timer. */}
      <span key={value} className={cn(!reducedMotion && 'pop')} aria-live="polite">
        {value}
      </span>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={disabled || atMax}
        aria-label={increaseLabel}
      >
        +
      </button>
    </div>
  );
}
