'use client';

/**
 * SearchResults — the `/search` body.
 *
 * Server-rendered first: the route loads the results and passes them in as
 * `initialData`, so the first HTML response already contains the grid. That is
 * the same `initialData` pattern the category and product routes use, and it is
 * the reason this page is indexable-but-not-indexed rather than empty.
 *
 * The sort control is the category listing's own `SortSelect`, reused rather
 * than reimplemented — one control, one set of labels, and the reference's
 * `#f-sort` options stay in exactly one place.
 *
 * Sorting is applied client-side over the loaded result set. The server can sort
 * too, but a search result set is bounded by `MAX_PAGE_LIMIT` and re-fetching on
 * every sort change would throw away scroll position and the first-paint
 * advantage. Same trade the category listing already makes.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import type { ProductDto } from '@/types/catalog';
import { useLang } from '@/lib/hooks';
import type { SortKey } from '@/lib/category-filters';
import { ProductCard } from '@/components/product/product-card';
import { EmptyState } from '@/components/shared/empty-state';
import { SortSelect } from '@/components/category/filter-panel';
import { CATEGORIES } from '@/lib/categories';

export interface SearchResultsProps {
  /** The term as typed, already trimmed. Empty or 1 character means no query. */
  term: string;
  /** Results loaded on the server. Empty when the term was too short. */
  initialData: ProductDto[];
  /** The sort the server applied, so the select starts in the right state. */
  initialSort: SortKey;
}

/** Sorts a result set in place-copy, matching the server's `orderByFor`. */
function sortResults(items: ProductDto[], sort: SortKey): ProductDto[] {
  const copy = [...items];

  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'popular':
      return copy.sort((a, b) => b.reviewCount - a.reviewCount);
    case 'price_asc':
      return copy.sort((a, b) => a.pricePoisha - b.pricePoisha);
    case 'price_desc':
      return copy.sort((a, b) => b.pricePoisha - a.pricePoisha);
    case 'rating':
      return copy.sort((a, b) => b.rating - a.rating);
    default:
      // 'relevance' is the server's own order; keep it exactly as delivered.
      return copy;
  }
}

export function SearchResults({ term, initialData, initialSort }: SearchResultsProps) {
  const { t, tu } = useLang();
  const [sort, setSort] = useState<SortKey>(initialSort);

  const results = useMemo(() => sortResults(initialData, sort), [initialData, sort]);

  const tooShort = term.length < 2;
  const hasResults = results.length > 0;

  /**
   * The empty state offers three real escapes, not a blank grid:
   *   1. a spelling hint and the popular products, which is where a miss usually
   *      belongs;
   *   2. category links, because a shopper who mistyped a product name often
   *      knows the aisle;
   *   3. "browse all", which goes to the homepage listing.
   */
  const emptyState = (
    <EmptyState
      tone="search"
      title={tooShort ? tu('searchTooShort') : t('nores')}
      body={
        tooShort
          ? tu('searchTooShortBody')
          : tu('searchNoResultsBody', { q: term })
      }
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link className="btn red" href="/">
            {tu('browseAll')}
          </Link>
          <Link className="btn" href="/#popular">
            {t('pop')}
          </Link>
        </div>
      }
    />
  );

  return (
    <div className="wrap">
      <div className="tb" style={{ marginTop: 18 }}>
        <span className="count" aria-live="polite">
          {tooShort
            ? tu('searchPrompt')
            : t('showing', { a: results.length, b: results.length })}
        </span>

        {hasResults && <SortSelect value={sort} onChange={setSort} />}
      </div>

      {hasResults ? (
        <>
          <div className="cat-grid">
            {results.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          {/* The aisle escape, below the grid where it does not compete. */}
          <section className="sec">
            <h4>{tu('browseCategories')}</h4>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.slice(0, 8).map((category) => (
                <Link
                  key={category.id}
                  className="chip"
                  href={`/category/${category.id}`}
                >
                  <span aria-hidden="true">{category.emoji}</span> {category.nameEn}
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : (
        emptyState
      )}
    </div>
  );
}
