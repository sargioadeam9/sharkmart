/**
 * Prepend the Phase 8 close-out entry to HANDOFF.md.
 * Node, not PowerShell — see HANDOFF landmine #1 (Set-Content destroys UTF-8).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'HANDOFF.md';
const text = readFileSync(path, 'utf8');

const marker = '## 2026-11-12 · Phase 8 (part 2) · Saffron · cart sync + variant model · complete';

const entry = `## 2026-11-12 · Phase 8 (part 3) · Saffron · follow-ups closed · PHASE 8 DONE

**What this session did**

The three items the part-2 entry listed as "not done" were already fixed in the working tree before this
session started — the part-2 note was written before those edits landed and was never corrected. Verified
each one against the code rather than trusting the note:

1. **\`VariantOptionDto.id\` is gone.** \`src/types/catalog.ts:147-161\` and \`mappers.ts:580-589\` both publish
   \`valueKey\` (\`attributeId:value\`) with a doc comment saying it is not a variant id. \`variant-selector.tsx:54\`
   builds the same key client-side. The trap the note warned about no longer exists.
2. **\`phase8.test.ts\` cleans up after itself.** The \`CONC-*\` probe is deleted in a \`finally\` block
   (\`phase8.test.ts:716-721\`), ordered OrderItem → CartItem → variant → product because \`OrderItem\` holds a
   non-cascading reference. A live check found **0 \`CONC-*\` products** in the database, so the three leftovers
   the note mentioned were already gone.
3. **The skipped count reaches the shopper.** \`session-provider.tsx:81-86\` toasts \`cartMergePartial\` with
   \`{count}\` when \`skipped > 0\` and \`cartMerged\` on a clean merge. Both strings exist in EN and BN
   (\`account-strings.ts:170-171, 326-327\`), spread into \`UI_STRINGS\` via \`...ACCOUNT_STRINGS\`.

**Added**

- \`server/prisma/cleanup-conc.ts\` — idempotent one-off that removes any \`CONC-*\` product, its variants, cart
  lines and order lines. Run with \`npx tsx prisma/cleanup-conc.ts\`. Found nothing to do today; kept so a future
  failed test run can be cleaned without hand-writing SQL.
- \`tools/update-status-phase8.mjs\` — the doc updater used for this session (Node, UTF-8 safe).

**Verified** (re-run from scratch this session, not carried over)

- \`npx tsc --noEmit\` → exit 0, **both** packages.
- \`npm test\` (server) → **89/89 pass**, 5 files, 16.55s.
- \`npm run build\` → green; 171 product pages + 14 categories prerendered, \`/login\`, \`/register\`, \`/search\`,
  \`/orders/[id]\` dynamic.
- \`npm run lint\` → **0 errors**, 2 warnings, both pre-existing (\`layout.tsx\` font, \`wishlist-page.tsx\` deps).
- \`npx tsx prisma/cleanup-conc.ts\` → \`0 CONC-* products\`.

**Not done**

- No new browser pass this session. The part-2 browser evidence (merge → badge 1 → drawer → \`/cart\` subtotal all
  agreeing, drawer decrement reaching the server) stands as the last live verification and was not re-run.
- Redis is still not installed locally; cache and rate limiter run on the in-process fallback. Correct for a
  single process, not for production. Unchanged from Phase 6.

**Assumed**

- The part-2 note's "not done" list was stale rather than the code being reverted. Confirmed by reading each of
  the three call sites; nothing regressed.

**Landmines**

- \`HANDOFF.md\` entries are written at the end of a session and can go stale within the same session if more work
  lands afterwards. Read the code before acting on a "not done" list — this session's entire job was that check.

**Exact next step**

- Run the Phase 9 master prompt (\`prompts/masterbuild.md:676\`) — admin shell + core modules. Phase 9 is the first
  phase that must not share a token namespace with the storefront (landmine #1: \`#c8143c\` vs \`#C51F4B\`).

---

`;

if (!text.includes(marker)) {
  console.error('MISS: part-2 marker not found');
  process.exit(1);
}

writeFileSync(path, text.replace(marker, entry + marker), 'utf8');
console.log('HANDOFF.md updated');
