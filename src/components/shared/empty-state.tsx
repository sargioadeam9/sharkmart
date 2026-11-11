/**
 * EmptyState — the reference's `.empty` (oshoppingbd.html L293-294), plus the
 * error variant the reference never needed because it had no network.
 *
 * One component, three tones, because in practice the difference between "no
 * results", "nothing here yet" and "the request failed" is the icon, the copy
 * and whether there is a retry button.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type EmptyStateTone = 'empty' | 'error' | 'search';

export interface EmptyStateProps {
  tone?: EmptyStateTone;
  /** Emoji or icon element. */
  icon?: ReactNode;
  title: string;
  body?: string;
  /** Optional call to action. */
  action?: ReactNode;
  className?: string;
}

const DEFAULT_ICON: Record<EmptyStateTone, string> = {
  empty: '🛍️',
  error: '⚠️',
  search: '🔍',
};

export function EmptyState({
  tone = 'empty',
  icon,
  title,
  body,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn('empty', className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className="e" aria-hidden="true">
        {icon ?? DEFAULT_ICON[tone]}
      </div>
      <h3>{title}</h3>
      {body && <p className="mx-auto max-w-[42ch] text-[13.5px]">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
