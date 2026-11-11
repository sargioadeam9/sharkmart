import { readFileSync, writeFileSync } from 'node:fs';

const path = 'STATUS.md';
let text = readFileSync(path, 'utf8');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

const start = text.indexOf('### Phase 3 — gate evidence');
const end = text.indexOf('### Phase 2 — gate evidence');
if (start < 0 || end < 0) {
  console.error('ABORT: markers missing');
  process.exit(1);
}

const block = `### Phase 3 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| All 16 sections from the reference's \`home()\` present, in reference order | ✅ | hero → trust → own brands → external brands → flash → categories → new → best → only → trending → promos → featured → recommended → recently viewed → popular → newsletter |
| Hero matches reference geometry | ✅ | \`min-height: 380px\` measured live; 4 slides, prev disabled at start, dots 1–4 |
| Product rails populated from the API layer | ✅ | 14 cards per rail; featured 13 (reference filters \`r >= 4.3\`) |
| Carousels auto-scroll, pause on hover/focus | ✅ | Reference-parity rAF drift (0.5px/frame, ping-pong at both ends). Measured drift \`22.4 → 23.2 → 24\`; frozen at \`26.4\` across 6 samples while hovered. \`prefers-reduced-motion\` disables it |
| Arrows hidden when no overflow; disabled at ends | ✅ | 11 overflowing \`.car-track\` containers, arrows shown; prev disabled at scroll start |
| Promo banners | ✅ | 3 cards with reference accents |
| Recently-viewed empty state | ✅ | "এখনো কিছু দেখা হয়নি" + body copy when nothing viewed |
| Newsletter | ✅ | \`input[type=email]\`, placeholder "আপনার ইমেইল", submit "সাবস্ক্রাইব" |
| Language toggle updates every section in one click | ✅ | EN → \`html lang="en"\`, \`body\` class cleared, \`৳1,890\`; বাংলা → \`body.bn\`, \`৳২,০০০\`, hero label "অফার" |
| Bangla does not break layout (landmine #6) | ✅ | \`body.bn\` applies \`line-height: 1.25\`; no horizontal overflow at 1280 (\`scrollWidth 1263\`) |
| Preview strip is dev-only, absent by default | ✅ | \`components/layout/preview-strip.tsx\` returns \`null\` unless \`NEXT_PUBLIC_SHOW_PREVIEW_STRIP === "true"\`; absent from DOM at default |
| \`tsc\` / \`lint\` / \`build\` all pass | ✅ | exit 0 / 0 errors, 1 pre-existing font warning / 4 routes prerendered |
| Console clean in the browser | ✅ | 0 errors, 0 warnings on \`/\` |

**Note on carousels:** \`scroll-snap-type: x proximity\` was removed from \`.car-track\`. It is not in the reference, and it snapped every sub-pixel drift write straight back to the nearest card, so auto-scroll never moved. Drag, arrows and touch momentum are unaffected.

**Not verified in this session:** side-by-side parity at 1440 and 390, and LCP/CLS. The automation browser renders at ~2fps and offers no resize tool, so those two gate items need a real browser pass.

`;

text = text.slice(0, start) + block + text.slice(end);
writeFileSync(path, text, 'utf8');
console.log(`bytes=${Buffer.byteLength(text, 'utf8')}`);
console.log(`blocks=${(text.match(/### Phase 3 — gate evidence/g) || []).length}`);
console.log(`delta-claim present: ${text.includes('Delta vs.')}`);
