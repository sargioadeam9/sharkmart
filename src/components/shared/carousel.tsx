'use client';

/**
 * Carousel — the reference's `.car` / `.car-track` / `.car-btn`
 * (oshoppingbd.html L139-153).
 *
 * What the reference does with ~15 lines of CSS and a drag handler, done
 * properly:
 *
 *   - Native scroll with `scroll-snap-type: x proximity`. No transform-based
 *     slider, so touch momentum, trackpad and keyboard all work for free.
 *   - Arrows scroll by one page and disable at the ends.
 *   - Arrows are hidden entirely when the track does not overflow
 *     (`.car.noscroll`), which the reference computes at render time and gets
 *     wrong on resize. Here a ResizeObserver keeps it honest.
 *   - Pointer drag with a movement threshold, so a click on a card still
 *     navigates. The reference sets `pointer-events: none` on links during a
 *     drag, which is why its cards feel unclickable on a slow drag.
 *   - Auto-scroll pauses when the carousel leaves the viewport
 *     (IntersectionObserver) and when the user hovers or focuses it.
 *   - `prefers-reduced-motion` disables auto-scroll and smooth scrolling.
 *
 * Children are laid out by the CSS `--per` variable, so the caller passes a
 * `perView` preset rather than a pixel width.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/hooks';

export type CarouselPreset = 'per-prod' | 'per-brand' | 'per-cat' | 'per-ext' | 'per-mini';

export interface CarouselProps {
  children: ReactNode;
  /** Which responsive items-per-view set to use. */
  preset?: CarouselPreset;
  /**
   * Auto-scroll. `0` (default) disables it. Any value > 0 enables the
   * reference's continuous drift and sets how long (ms) the drift stays held
   * after a user interaction — the reference's `pause(3500)`.
   */
  autoScrollMs?: number;
  /** Accessible name for the scroll region. */
  label: string;
  previousLabel: string;
  nextLabel: string;
  className?: string;
  /** Applied to the track — used for grid fallbacks in later phases. */
  trackClassName?: string;
}

export function Carousel({
  children,
  preset = 'per-prod',
  autoScrollMs = 0,
  label,
  previousLabel,
  nextLabel,
  className,
  trackClassName,
}: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const [overflows, setOverflows] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);

  // Declared before the auto-scroll effect, which reads `drag.current.active`.
  const drag = useRef({
    active: false,
    startX: 0,
    startScroll: 0,
    moved: false,
  });

  // ── Overflow + edge detection ──────────────────────────────────────────
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    const max = track.scrollWidth - track.clientWidth;
    setOverflows(max > 4);
    setAtStart(track.scrollLeft <= 4);
    setAtEnd(track.scrollLeft >= max - 4);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(track);

    // Children can change width without the track resizing (e.g. a font swap).
    const mutation = new MutationObserver(measure);
    mutation.observe(track, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, [measure]);

  // ── Pause auto-scroll when off-screen ──────────────────────────────────
  useEffect(() => {
    const track = trackRef.current;
    if (!track || autoScrollMs <= 0) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.25 },
    );
    observer.observe(track);

    return () => observer.disconnect();
  }, [autoScrollMs]);

  // ── Auto-scroll ────────────────────────────────────────────────────────
  //
  // The reference (`oshoppingbd.html` L796-806) does not page on a timer. It
  // drifts the track by half a pixel per frame and ping-pongs at both ends,
  // pausing on hover, focus, wheel, touch and drag. Reproduced here because the
  // gate calls for "auto-scroll, pause on hover/focus" and a 5s page-jump reads
  // as a different interaction entirely.
  //
  // `autoScrollMs` is the hold duration after a user interaction (the
  // reference's `pause(3500)`), not an interval.
  useEffect(() => {
    if (autoScrollMs <= 0 || reducedMotion) return;

    const track = trackRef.current;
    if (!track) return;

    let frame = 0;
    let position = track.scrollLeft;
    let direction = 1;
    let held = false;
    let holdTimer = 0;

    const hold = () => {
      held = true;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        held = false;
        position = track.scrollLeft;
      }, autoScrollMs);
    };

    const max = () => track.scrollWidth - track.clientWidth;

    const tick = () => {
      if (!track.isConnected) return;

      const limit = max();
      if (inView && !paused && !held && !drag.current.active && limit > 4) {
        // Re-sync if something else moved the track (arrow, drag, wheel).
        if (Math.abs(track.scrollLeft - position) > 2) position = track.scrollLeft;

        position += direction * 0.5;
        if (position >= limit) {
          position = limit;
          direction = -1;
        }
        if (position <= 0) {
          position = 0;
          direction = 1;
        }
        track.scrollLeft = position;
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    track.addEventListener('wheel', hold, { passive: true });
    track.addEventListener('touchstart', hold, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(holdTimer);
      track.removeEventListener('wheel', hold);
      track.removeEventListener('touchstart', hold);
    };
  }, [autoScrollMs, reducedMotion, inView, paused]);

  // ── Arrow paging ───────────────────────────────────────────────────────
  const page = useCallback((direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;

    track.scrollBy({
      left: direction * track.clientWidth * 0.9,
      behavior: 'smooth',
    });
  }, []);

  // ── Pointer drag ───────────────────────────────────────────────────────
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Let the browser own touch scrolling — dragging it manually breaks momentum.
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;

    const track = trackRef.current;
    if (!track) return;

    drag.current = {
      active: true,
      startX: event.clientX,
      startScroll: track.scrollLeft,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const state = drag.current;
    if (!track || !state.active) return;

    const delta = event.clientX - state.startX;

    // 6px threshold: below it, this is a click, not a drag.
    if (!state.moved && Math.abs(delta) > 6) {
      state.moved = true;
      track.classList.add('drag');
      track.setPointerCapture(event.pointerId);
    }

    if (state.moved) {
      track.scrollLeft = state.startScroll - delta;
    }
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const state = drag.current;
    if (!track || !state.active) return;

    state.active = false;
    track.classList.remove('drag');

    if (track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }

    // Suppress the click that follows a real drag, so a card does not navigate.
    if (state.moved) {
      const swallow = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };
      track.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => {
        track.removeEventListener('click', swallow, { capture: true });
      }, 0);
    }

    state.moved = false;
  }, []);

  const showArrows = overflows;

  return (
    <div
      className={cn('car', preset, !overflows && 'noscroll', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {showArrows && (
        <button
          type="button"
          className="car-btn prev"
          onClick={() => page(-1)}
          disabled={atStart}
          aria-label={previousLabel}
          aria-controls={undefined}
        >
          ‹
        </button>
      )}

      <div
        ref={trackRef}
        className={cn('car-track', trackClassName)}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {children}
      </div>

      {showArrows && (
        <button
          type="button"
          className="car-btn next"
          onClick={() => page(1)}
          disabled={atEnd}
          aria-label={nextLabel}
        >
          ›
        </button>
      )}
    </div>
  );
}
