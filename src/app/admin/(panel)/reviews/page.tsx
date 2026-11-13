/**
 * Reviews — `/admin/reviews`.
 *
 * A server component: it reads the query string, fetches once from
 * `GET /api/v1/admin/reviews` plus `/counts`, and renders. No figure on this page
 * is computed in the browser — the tab badges and every row's state arrive from
 * the endpoint, because "pending" and "rejected" differ only by `moderatedAt` and
 * a second copy of that rule would drift from the one the counts use.
 *
 * ── The tabs ────────────────────────────────────────────────────────────────
 *
 * `?state=pending` (default) is the queue. `approved`, `rejected`, `flagged` and
 * `all` are the archive. The state lives in the URL so a filtered view survives a
 * refresh and the back button does what the operator expects.
 *
 * Pending is the default deliberately: an operator arriving here has work to do,
 * and defaulting to `all` would bury it under approved history.
 *
 * ── The rating decision, and why this screen says so out loud ───────────────
 *
 * The seed copies `ratingAvg`/`reviewCount` out of the reference catalog
 * (`seed.ts:698`) while refusing to create the reviews those counts describe
 * (`seed.ts:496`). The products table therefore advertises 42,084 reviews that do
 * not exist. Moderation does NOT recompute those columns — that is option A,
 * documented at the top of `review.service.ts` — so approving a review here will
 * not move the storefront's stars.
 *
 * The drawer shows the stored aggregate next to the real approved count and says
 * the two do not agree. That is the honest presentation: a moderator who approves
 * a review, sees nothing change, and files a bug is a worse outcome than one who
 * is told why up front.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type {
  ReviewCounts,
  ReviewListItem,
  ReviewListResponse,
  ReviewSort,
  ReviewState,
} from '@/lib/api/admin-reviews';
import { ReviewsTable, ReviewTabs } from '@/components/admin/reviews-table';

export const metadata: Metadata = {
  title: 'Reviews',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Admin surface uses lakh grouping (AGENTS.md §3). */
function num(value: number, lang: 'en' | 'bn'): string {
  return value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');
}

const VALID_STATES: ReviewState[] = ['pending', 'approved', 'rejected', 'flagged', 'all'];
const VALID_SORTS: ReviewSort[] = ['newest', 'oldest', 'rating_desc', 'rating_asc'];

interface MeResponse {
  permissions: string[];
}

export default async function ReviewsPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const rawState = one(params.state) ?? 'pending';
  const state: ReviewState = VALID_STATES.includes(rawState as ReviewState)
    ? (rawState as ReviewState)
    : 'pending';

  const rawSort = one(params.sort) ?? 'newest';
  const sort: ReviewSort = VALID_SORTS.includes(rawSort as ReviewSort)
    ? (rawSort as ReviewSort)
    : 'newest';

  const q = one(params.q) ?? '';
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (state !== 'pending') query.set('state', state);
  if (sort !== 'newest') query.set('sort', sort);
  query.set('page', String(page));
  query.set('limit', String(limit));

  let items: ReviewListItem[] = [];
  let total = 0;
  let counts: ReviewCounts = { pending: 0, approved: 0, rejected: 0, flagged: 0, all: 0 };
  let canModerate = false;
  let error: string | null = null;

  try {
    /**
     * Three calls in parallel: the page, the badges, and the caller's own
     * permissions. `/admin/me` is the authoritative answer to "may I moderate" —
     * the API enforces it independently, and hiding the buttons is UX on top of
     * that, not the control.
     */
    const [list, countData, me] = await Promise.all([
      adminFetchServer<ReviewListResponse>(`/admin/reviews?${query.toString()}`),
      adminFetchServer<ReviewCounts>('/admin/reviews/counts'),
      adminFetchServer<MeResponse>('/admin/me'),
    ]);

    items = list.data.items;
    total = list.data.total;
    counts = countData.data;
    canModerate = me.data.permissions.includes('reviews:moderate');
  } catch (caught) {
    if (caught instanceof AdminApiError) {
      error = caught.message;
    } else {
      error = lang === 'bn' ? 'পর্যালোচনা লোড করা যায়নি।' : 'Could not load reviews.';
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/reviews?${next.toString()}`;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'পর্যালোচনা' : 'Reviews'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${num(counts.pending, lang)}টি অপেক্ষমাণ · ${num(counts.all, lang)}টি মোট`
              : `${num(counts.pending, lang)} pending · ${num(counts.all, lang)} total`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <>
          <ReviewTabs
            lang={lang}
            active={state}
            counts={counts}
            hrefs={{
              pending: hrefWith({ state: undefined, page: undefined }),
              approved: hrefWith({ state: 'approved', page: undefined }),
              rejected: hrefWith({ state: 'rejected', page: undefined }),
              flagged: hrefWith({ state: 'flagged', page: undefined }),
              all: hrefWith({ state: 'all', page: undefined }),
            }}
          />

          <ReviewsTable
            lang={lang}
            items={items}
            total={total}
            page={page}
            limit={limit}
            totalPages={totalPages}
            prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
            nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
            canModerate={canModerate}
            activeState={state}
          />
        </>
      )}
    </>
  );
}
