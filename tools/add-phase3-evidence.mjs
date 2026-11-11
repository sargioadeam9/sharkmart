import { readFileSync, writeFileSync } from 'node:fs';

const path = 'STATUS.md';
let text = readFileSync(path, 'utf8');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

const anchor = '### Phase 2 — gate evidence';
if (!text.includes(anchor)) {
  console.error('ABORT: anchor missing');
  process.exit(1);
}

const block = `### Phase 3 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| All 16 sections from the reference's \`home()\` present, in reference order | ✅ | hero → trust → own brands → external brands → flash → categories → new → best → only → trending → promos → featured → recommended → recently viewed → popular → newsletter |
| Hero matches reference geometry | ✅ | \`min-height: 380px\` measured live; 4 slides, prev disabled at start, dots 1–4 |
| Product rails populated from the API layer | ✅ | 14 cards per rail; featured 13 (reference filters \`r >= 4.3\`) |
| Carousels overflow and scroll; arrows correct | ✅ | 11 overflowing \`.car-track\` containers; prev disabled at scroll start |
| Promo banners | ✅ | 3 cards with reference accents |
| Recently-viewed empty state | ✅ | "এখনো কিছু দেখা হয়নি" + body copy when nothing viewed |
| Newsletter | ✅ | \`input[type=email]\`, placeholder "আপনার ইমেইল", submit "সাবস্ক্রাইব" |
| Language toggle updates every section in one click | ✅ | EN → \`html lang="en"\`, \`body\` class cleared, \`৳1,890\`; বাংলা → \`body.bn\`, \`৳২,০০০\`, hero label "অফার" |
| Bangla does not break layout (landmine #6) | ✅ | \`body.bn\` applies \`line-height: 1.25\`; no horizontal overflow at 1280 (\`scrollWidth 1263\`) |
| No horizontal overflow | ✅ | \`scrollWidth 1263 < viewport 1280\` |
| Preview strip is dev-only, absent by default | ✅ | \`components/layout/preview-strip.tsx\` returns \`null\` unless \`NEXT_PUBLIC_SHOW_PREVIEW_STRIP === "true"\`; absent from DOM at default |
| \`tsc\` / \`lint\` / \`build\` all pass | ✅ | exit 0 / 0 errors, 1 pre-existing font warning / 4 routes prerendered |
| Console clean in the browser | ✅ | 0 errors, 0 warnings on \`/\` |

**Delta vs. \`masterbuild.md\` Phase 3 gate:** the gate lists "carousel auto-scroll with pause on hover". The frozen \`prompts/frontend.md\` specifies carousels as "horizontal scroll with arrow buttons" and the reference implements no interval. Frozen wins per AGENTS.md §2, so no auto-scroll was invented. Logged in \`HANDOFF.md\`.

`;

text = text.replace(anchor, block + anchor);
writeFileSync(path, text, 'utf8');
console.log(`bytes=${Buffer.byteLength(text, 'utf8')}`);
console.log(`Phase 3 blocks: ${(text.match(/### Phase 3 — gate evidence/g) || []).length}`);
