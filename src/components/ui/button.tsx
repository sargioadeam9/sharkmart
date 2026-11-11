'use client';

/**
 * Button — the reference's `.btn`, `.btn.red`, `.btn.line`, `.btn.addl` and
 * `.btn-add`, with the loading and success states from
 * prompts/frontend.md §8.
 *
 * Visual values live in components.css (ported 1:1 from oshoppingbd.html
 * L111-115, L204-211, L371-373). This component only decides which class to
 * apply and what to render inside it.
 *
 * The success state is transient and self-reverting: `onClick` runs, the button
 * shows a check for `successMs`, then returns to normal. That is the
 * reference's add-to-cart behaviour (`addCart()` in oshoppingbd.html L777) and
 * it is why the button owns the timer rather than the caller.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'outline' | 'add' | 'addOutline' | 'plain';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks. */
  loading?: boolean;
  /** Shows a check for `successMs`, then reverts. */
  success?: boolean;
  successMs?: number;
  /** Rendered before the label. Hidden while loading. */
  icon?: ReactNode;
  /** Rendered after the label. Hidden while loading. */
  iconEnd?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn red',
  outline: 'btn line',
  add: 'btn-add',
  addOutline: 'btn addl',
  plain: 'btn',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'text-[13px] px-4 py-2',
  md: '',
  lg: 'text-base px-8 py-3.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      success = false,
      successMs = 1100,
      icon,
      iconEnd,
      fullWidth = false,
      disabled,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    const [showSuccess, setShowSuccess] = useState(success);
    const timer = useRef<number | null>(null);

    useEffect(() => {
      if (!success) return;

      timer.current = window.setTimeout(() => setShowSuccess(false), successMs);

      return () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
      };
    }, [success, successMs]);

    // `success` is a rising-edge signal: show the check while it is true, and
    // clear it when the parent drops it. Adjusting during render (rather than
    // in an effect) avoids a cascading render and the flash of the old label.
    const [lastSuccess, setLastSuccess] = useState(success);
    if (success !== lastSuccess) {
      setLastSuccess(success);
      if (success) setShowSuccess(true);
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          loading && 'ld',
          showSuccess && 'ok',
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        {/* Children stay mounted so the button keeps its width while the
            spinner replaces the label — a collapsing button is a layout bug. */}
        {showSuccess ? (
          <>
            <span aria-hidden="true">✓</span>
            <span className="sr-only-focusable">{children}</span>
          </>
        ) : (
          <>
            {!loading && icon}
            {children}
            {!loading && iconEnd}
          </>
        )}
      </button>
    );
  },
);

/**
 * Convenience wrapper for the add-to-cart button, which is the one button that
 * needs the full load -> success -> revert cycle in a single click handler.
 *
 *   const [state, run] = useAddToCartState();
 *   <AddToCartButton state={state} onClick={run}>Add to Cart</AddToCartButton>
 */
export type AddToCartState = 'idle' | 'loading' | 'success';

export function useAddToCartState(loadingMs = 350, successMs = 1100) {
  const [state, setState] = useState<AddToCartState>('idle');
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    },
    [],
  );

  const run = useCallback(
    (action: () => void) => {
      setState('loading');
      timers.current.push(
        window.setTimeout(() => {
          action();
          setState('success');
          timers.current.push(
            window.setTimeout(() => setState('idle'), successMs),
          );
        }, loadingMs),
      );
    },
    [loadingMs, successMs],
  );

  return [state, run] as const;
}

export interface AddToCartButtonProps
  extends Omit<ButtonProps, 'variant' | 'loading' | 'success'> {
  state?: AddToCartState;
  /** Label shown while in the success state. */
  successLabel?: string;
}

export function AddToCartButton({
  state = 'idle',
  successLabel,
  children,
  ...rest
}: AddToCartButtonProps) {
  return (
    <Button
      variant="add"
      loading={state === 'loading'}
      success={state === 'success'}
      {...rest}
    >
      {state === 'success' && successLabel ? successLabel : children}
    </Button>
  );
}
