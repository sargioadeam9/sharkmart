/**
 * The one renderer behind `/help`, `/return`, `/privacy`, `/terms` and `/about`.
 *
 * ── Why a server component ─────────────────────────────────────────────────
 *
 * These pages are prose. There is nothing to hydrate, nothing to fetch in the
 * browser, and nothing personal on them, so they render on the server and ship
 * as HTML. That also means the text is in the first response for a crawler and
 * for a customer on a slow connection — which, for the page someone opens when
 * a parcel has gone missing, is the whole point.
 *
 * ── Layout ─────────────────────────────────────────────────────────────────
 *
 * Two columns on a wide screen: a sticky contents rail and the document. Below
 * 900px the rail becomes a horizontal list of links above the text, because a
 * sticky sidebar on a phone is a way to lose 40% of the reading width.
 *
 * The prose measure is capped at 68 characters. A policy paragraph that runs the
 * full width of a 1320px container is a paragraph nobody finishes.
 */

import Link from 'next/link';

import type { DocContent } from '@/lib/legal/content';
import type { Lang } from '@/lib/legal/content';

/** Every policy page, so each one can offer the others. */
export const DOC_NAV: Array<{ key: string; href: string; en: string; bn: string }> = [
  { key: 'help', href: '/help', en: 'Help & support', bn: 'হেল্প ও সাপোর্ট' },
  { key: 'return', href: '/return', en: 'Returns & refunds', bn: 'রিটার্ন ও রিফান্ড' },
  { key: 'privacy', href: '/privacy', en: 'Privacy policy', bn: 'প্রাইভেসি পলিসি' },
  { key: 'terms', href: '/terms', en: 'Terms & conditions', bn: 'শর্তাবলি' },
  { key: 'about', href: '/about', en: 'About us', bn: 'আমাদের সম্পর্কে' },
];

export function DocPage({
  content,
  lang,
  current,
}: {
  content: DocContent;
  lang: Lang;
  /** The key of this page in `DOC_NAV`, so it is not offered as a "see also". */
  current: string;
}) {
  const others = DOC_NAV.filter((item) => item.key !== current);
  const showContents = content.sections.length >= 4;

  return (
    <article className="docpage" aria-labelledby="doc-title">
      <div className="wrap docpage-wrap">
        <header className="docpage-head">
          <h1 id="doc-title">{content.title}</h1>
          <p className="docpage-sub">{content.subtitle}</p>
          <p className="docpage-updated">{content.updated}</p>
        </header>

        <div className="docpage-grid">
          <aside className="docpage-rail" aria-label={lang === 'bn' ? 'সূচি' : 'Contents'}>
            {showContents && (
              <nav className="docpage-toc">
                <h2>{lang === 'bn' ? 'এই পাতায়' : 'On this page'}</h2>
                <ol>
                  {content.sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`}>{section.heading}</a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            <nav className="docpage-other">
              <h2>{lang === 'bn' ? 'অন্য নীতিমালা' : 'Other policies'}</h2>
              <ul>
                {others.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href}>{lang === 'bn' ? item.bn : item.en}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="docpage-body">
            {content.sections.map((section) => (
              <section key={section.id} id={section.id} className="docpage-section">
                <h2>{section.heading}</h2>

                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}

                {section.bullets && section.bullets.length > 0 && (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}

                {section.note && <p className="docpage-note">{section.note}</p>}

                {section.links && section.links.length > 0 && (
                  <p className="docpage-links">
                    {section.links.map((link) => (
                      <Link key={link.href} href={link.href} className="docpage-link">
                        {link.label}
                      </Link>
                    ))}
                  </p>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
