'use client';

/**
 * ProductGallery — the reference's `drawGal()` (oshoppingbd.html L766-768) plus
 * the `.gm .tools` zoom controls and the fullscreen lightbox.
 *
 * The reference has no real photos: it renders the product emoji on a
 * category-tinted radial gradient and fakes five "angles" with CSS transforms
 * (`ANG` array: Front, Back, Side, Detail, In use). That is the design truth, so
 * it is reproduced exactly rather than replaced with a single image.
 *
 * When a product does have real images (`product.images`), those render instead
 * and the transform trick is skipped. Both paths share the same thumbnail strip,
 * zoom and lightbox, so the page behaves identically either way.
 *
 * Accessibility:
 *   - The lightbox is a real dialog: focus moves in, Tab is trapped, Escape
 *     closes, arrows navigate, and focus returns to the thumbnail that opened it.
 *   - The zoom buttons are labelled, not glyph-only.
 *   - `prefers-reduced-motion` kills the transform transition (product.css).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useEscapeKey, useFocusReturn, usePrefersReducedMotion } from '@/lib/hooks';
import type { ProductImageDto } from '@/types/catalog';

/** The reference's five angles, verbatim (oshoppingbd.html L767). */
const ANGLES = [
  { key: 'front', en: 'Front', bn: 'সামনে', transform: '' },
  { key: 'back', en: 'Back', bn: 'পেছনে', transform: 'scaleX(-1)' },
  { key: 'side', en: 'Side', bn: 'পাশে', transform: 'rotate(-14deg)' },
  { key: 'detail', en: 'Detail', bn: 'বিস্তারিত', transform: 'scale(1.7)' },
  { key: 'inuse', en: 'In use', bn: 'ব্যবহারে', transform: 'rotate(10deg) scale(.85)' },
] as const;

export interface ProductGalleryProps {
  /** Real images, when the product has them. Empty falls back to the emoji. */
  images: ProductImageDto[];
  /** The product emoji — the reference's `.gm .z` glyph. */
  emoji: string;
  /** Category light tint — the gradient's outer stop. */
  tint: string;
  /** Selected colour swatch, when a variant group provides one. */
  swatch: string | null;
  /** Accessible product name, for alt text and labels. */
  productName: string;
  lang: 'en' | 'bn';
  labels: {
    zoomIn: string;
    zoomOut: string;
    fullscreen: string;
    close: string;
    previous: string;
    next: string;
    video: string;
    videoSub: string;
  };
}

export function ProductGallery({
  images,
  emoji,
  tint,
  swatch,
  productName,
  lang,
  labels,
}: ProductGalleryProps) {
  const reducedMotion = usePrefersReducedMotion();

  const [activeIndex, setActiveIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  /**
   * A placeholder is not a photo.
   *
   * The mock layer ships one `data:image/svg+xml` placeholder per product (a
   * tinted square with the emoji in it) so cards have something to render. That
   * is not a real product photo, and treating it as one made the gallery show a
   * single slide labelled "1/1" — while the reference shows five angles of the
   * same emoji via CSS transforms.
   *
   * So: a data-URI SVG counts as "no real image" and the five-angle fallback
   * runs. When Phase 6 serves real photo URLs, `hasRealImages` flips on its own
   * and the gallery shows the photos instead. No component change needed.
   */
  const realImages = images.filter(
    (image) => image.url && !image.url.startsWith('data:image/svg+xml'),
  );
  const hasRealImages = realImages.length > 0;
  const slideCount = hasRealImages ? realImages.length : ANGLES.length;

  const angle = ANGLES[activeIndex] ?? ANGLES[0];
  const activeImage = hasRealImages ? realImages[activeIndex] : undefined;

  /** The gradient backdrop. A selected swatch tints it, exactly as `pUpd()` does. */
  const backdrop = swatch
    ? `radial-gradient(circle at 50% 45%, #fff 0 22%, ${swatch}33 23% 100%)`
    : `radial-gradient(circle at 50% 45%, #fff 0 22%, ${tint} 23% 100%)`;

  const slideLabel = (index: number) => {
    if (hasRealImages) return `${productName} — ${index + 1}/${slideCount}`;
    const angleLabel = ANGLES[index] ?? ANGLES[0];
    return `${lang === 'bn' ? angleLabel.bn : angleLabel.en} · ${index + 1}/${slideCount}`;
  };

  const select = useCallback((index: number) => {
    setActiveIndex(index);
    setZoom(1);
  }, []);

  const step = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const next = (current + delta + slideCount) % slideCount;
        return next;
      });
      setZoom(1);
    },
    [slideCount],
  );

  useEscapeKey(() => setLightboxOpen(false), lightboxOpen);

  const focusReturn = useFocusReturn();

  // Capture the opener before the dialog mounts, restore it on close.
  useEffect(() => {
    if (lightboxOpen) {
      focusReturn.capture();
    } else {
      focusReturn.restore();
    }
    // `capture`/`restore` are stable useCallbacks; the open flag is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen]);

  /**
   * Lightbox keyboard handling. Arrow keys navigate; Tab is trapped inside the
   * dialog so the page behind it cannot be reached while it is open.
   */
  useEffect(() => {
    if (!lightboxOpen) return;

    const node = dialogRef.current;
    if (!node) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Tab') {
        const focusable = node.querySelectorAll<HTMLElement>(
          'button:not([disabled])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);

    // Move focus into the dialog on open.
    const firstButton = node.querySelector<HTMLElement>('button');
    firstButton?.focus();

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, step]);

  const zoomStyle = {
    transform: hasRealImages
      ? `scale(${zoom})`
      : `${angle.transform} scale(${zoom})`,
    transition: reducedMotion ? 'none' : undefined,
  } as const;

  return (
    <>
      <div className="gal">
        <div className="thumbs" role="group" aria-label={productName}>
          {Array.from({ length: slideCount }, (_, index) => (
            <button
              key={index}
              ref={(node) => {
                thumbRefs.current[index] = node;
              }}
              type="button"
              className={cn(index === activeIndex && 'on')}
              onClick={() => select(index)}
              aria-label={slideLabel(index)}
              aria-pressed={index === activeIndex}
            >
              {hasRealImages ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={realImages[index]?.url ?? ''}
                  alt=""
                  width={78}
                  height={78}
                  style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'block',
                    transform:
                      (ANGLES[index]?.transform ?? '').includes('1.7')
                        ? 'scale(1.3)'
                        : (ANGLES[index]?.transform ?? ''),
                  }}
                >
                  {emoji}
                </span>
              )}
            </button>
          ))}
        </div>

        <div>
          <div
            className="gm"
            style={{ background: backdrop }}
            onClick={() => setLightboxOpen(true)}
            role="button"
            tabIndex={0}
            aria-label={labels.fullscreen}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setLightboxOpen(true);
              }
            }}
          >
            {hasRealImages ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeImage?.url}
                alt={productName}
                style={zoomStyle}
                className="z"
              />
            ) : (
              <span className="z" style={zoomStyle} aria-hidden="true">
                {emoji}
              </span>
            )}

            <span className="lbl">{slideLabel(activeIndex)}</span>

            <div className="tools">
              <button
                type="button"
                aria-label={labels.zoomIn}
                onClick={(event) => {
                  event.stopPropagation();
                  setZoom((z) => Math.min(2.4, Number((z + 0.2).toFixed(2))));
                }}
              >
                ＋
              </button>
              <button
                type="button"
                aria-label={labels.zoomOut}
                onClick={(event) => {
                  event.stopPropagation();
                  setZoom((z) => Math.max(1, Number((z - 0.2).toFixed(2))));
                }}
              >
                －
              </button>
              <button
                type="button"
                aria-label={labels.fullscreen}
                onClick={(event) => {
                  event.stopPropagation();
                  setLightboxOpen(true);
                }}
              >
                ⛶
              </button>
            </div>
          </div>

          {/* The reference's video block. Click to play, never autoplay. */}
          <button type="button" className="vid">
            <span className="pl" aria-hidden="true">
              ▶
            </span>
            <span>
              <b>{labels.video}</b>
              <small>{labels.videoSub}</small>
            </span>
          </button>
        </div>
      </div>

      {lightboxOpen ? (
        <div
          className="pdlb"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={productName}
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightboxOpen(false);
          }}
        >
          <button
            type="button"
            className="close"
            aria-label={labels.close}
            onClick={() => setLightboxOpen(false)}
          >
            ✕
          </button>

          <button
            type="button"
            className="nav p"
            aria-label={labels.previous}
            onClick={() => step(-1)}
          >
            ‹
          </button>

          <div className="stage" style={{ color: '#fff' }}>
            {hasRealImages ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeImage?.url}
                alt={productName}
                style={{ maxHeight: '80vh', width: 'auto' }}
              />
            ) : (
              <span aria-hidden="true">{emoji}</span>
            )}
          </div>

          <button
            type="button"
            className="nav n"
            aria-label={labels.next}
            onClick={() => step(1)}
          >
            ›
          </button>

          <span className="count">{slideLabel(activeIndex)}</span>
        </div>
      ) : null}
    </>
  );
}
