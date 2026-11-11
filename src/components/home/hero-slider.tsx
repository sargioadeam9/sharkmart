'use client';

/**
 * HeroSlider — the reference's `.hero` / `.h-track` / `.h-sl` / `.h-ar` /
 * `.h-dots` (oshoppingbd.html L101-115, markup L654, behaviour L808-811).
 *
 * Behaviour ported from `initHero()`:
 *   - 4 slides, translateX(-index * 100%) on the track.
 *   - Auto-advance every 5.5s.
 *   - Pause on hover (reference: `onmouseenter` clears the interval).
 *   - Swipe on touch when the horizontal delta exceeds 40px.
 *   - Dots and arrows reset the timer, so a manual move gets a full interval.
 *
 * Deliberate differences, all of them fixes:
 *   - `prefers-reduced-motion` disables the auto-advance entirely. The
 *     reference checks `RM` once at boot and only skips starting the interval,
 *     which means a later preference change is ignored; here it is reactive.
 *   - The timer pauses when the hero scrolls out of view and when the tab is
 *     hidden, so a backgrounded tab does not burn CPU advancing slides nobody
 *     sees.
 *   - The interval is cleared on unmount. The reference leaks it, then clears a
 *     stale id from the router.
 *   - Slides are real content: each is a labelled group inside a carousel role,
 *     and the inactive ones are `aria-hidden` + `inert` so a screen reader does
 *     not read four headlines in a row.
 *   - The headline's `\n` becomes a <br>, so the reference's line break works
 *     in Bangla too.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { HERO_SLIDES } from '@/lib/home/hero-slides';
import { useLang, usePrefersReducedMotion } from '@/lib/hooks';
import { localized } from '@/types/catalog';

/** The reference's 5.5s interval. */
const AUTO_ADVANCE_MS = 5500;
/** The reference's 40px swipe threshold. */
const SWIPE_THRESHOLD_PX = 40;

export interface HeroSliderProps {
  /** Overrides the default slide set — used by the dev proof route. */
  slides?: typeof HERO_SLIDES;
}

export function HeroSlider({ slides = HERO_SLIDES }: HeroSliderProps) {
  const { lang, t, tu } = useLang();
  const reducedMotion = usePrefersReducedMotion();

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  const rootRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);

  const count = slides.length;

  const go = useCallback(
    (next: number) => {
      // Wrap in both directions, like the reference's `(i + len) % len`.
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  // ── Auto-advance ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion || paused || !inView || !tabVisible || count < 2) return;

    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, AUTO_ADVANCE_MS);

    return () => window.clearInterval(id);
  }, [reducedMotion, paused, inView, tabVisible, count]);

  // ── Pause when off-screen ──────────────────────────────────────────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.2 },
    );
    observer.observe(root);

    return () => observer.disconnect();
  }, []);

  // ── Pause when the tab is hidden ───────────────────────────────────────────
  useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // ── Keyboard: arrows move slides when the carousel has focus ───────────────
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(index + 1);
    }
  };

  // ── Touch swipe ────────────────────────────────────────────────────────────
  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStartX.current;
    if (start === null) return;

    const end = event.changedTouches[0]?.clientX ?? start;
    const delta = end - start;

    if (Math.abs(delta) > SWIPE_THRESHOLD_PX) {
      go(index + (delta < 0 ? 1 : -1));
    }

    touchStartX.current = null;
  };

  return (
    <section
      ref={rootRef}
      className="hero"
      aria-roledescription="carousel"
      aria-label={tu('offers')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="h-track"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {slides.map((slide, i) => {
          const active = i === index;
          const headline = localized(lang, slide.headlineEn, slide.headlineBn);

          return (
            <div
              key={slide.id}
              className="h-sl"
              style={{ background: slide.background }}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} ${tu('of')} ${count}`}
              aria-hidden={!active}
              // Inactive slides are not reachable by keyboard or AT.
              inert={!active}
            >
              <div className="tx">
                <span className="tg">
                  {localized(lang, slide.tagEn, slide.tagBn)}
                </span>

                <h2>
                  {headline.split('\n').map((line, lineIndex, lines) => (
                    <span key={lineIndex}>
                      {line}
                      {lineIndex < lines.length - 1 ? <br /> : null}
                    </span>
                  ))}
                </h2>

                <p>{localized(lang, slide.bodyEn, slide.bodyBn)}</p>

                <Link className="btn" href={slide.href} tabIndex={active ? 0 : -1}>
                  {t('seeAll')} →
                </Link>
              </div>

              <div className="art" aria-hidden="true">
                {slide.art.map((emoji, emojiIndex) => (
                  <span key={emojiIndex}>{emoji}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="h-ar p"
        aria-label={tu('previous')}
        onClick={() => go(index - 1)}
      >
        ‹
      </button>
      <button
        type="button"
        className="h-ar n"
        aria-label={tu('next')}
        onClick={() => go(index + 1)}
      >
        ›
      </button>

      <div className="h-dots">
        {slides.map((slide, i) => (
          <button
            key={`dot-${slide.id}`}
            type="button"
            className={i === index ? 'on' : undefined}
            aria-label={`${tu('of')} ${i + 1}`}
            aria-current={i === index ? 'true' : undefined}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </section>
  );
}
