/**
 * Extracts the catalog + i18n data out of the frozen reference
 * (oshoppingbd.html) into machine-readable files.
 *
 * Why a script instead of retyping: the reference holds 84 Bangla product
 * names, 84 Bangla subcategory names and ~180 bilingual UI strings. Retyping
 * them by hand is how you get a silent typo that only shows up in Bangla.
 *
 * Run: node tools/extract-reference.mjs
 * Output:
 *   data/reference-catalog.json          <- consumed by server/prisma/seed.ts
 *   src/lib/i18n/translations/en.ts
 *   src/lib/i18n/translations/bn.ts
 *
 * This is a one-shot generator. The frozen HTML never changes, so the output
 * is committed and the script is kept only as provenance.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'oshoppingbd.html'), 'utf8');

/** Pull `const NAME=[...]` / `const NAME={...}` out of the reference. */
function grab(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end === -1) throw new Error(`end marker not found for: ${startMarker}`);
  return html.slice(start + startMarker.length, end);
}

// ─── CATS ────────────────────────────────────────────────────────────────
const CATS = eval(grab('const CATS=', '\nconst OWN='));

// ─── OWN (house brands) ──────────────────────────────────────────────────
const OWN = eval(grab('const OWN=', '\nconst EXT='));

// ─── EXT (external brands) ───────────────────────────────────────────────
const EXT = eval(grab('const EXT=', '\nconst SLIDES='));

// ─── House-brand rename map ──────────────────────────────────────────────
// The reference's house brands carry an "O" prefix inherited from the old
// OShoppingBD brand (OFashion, OBeauty, …). SharkMart drops it so each brand
// reads as a plain noun. This lives above the product loop because the product
// rows reference `c.own` too — one map keeps the slug, both display names and
// the product's brand reference from ever disagreeing.
//
// AGENTS.md §2.1: the frozen HTML still says OFashion. That is expected; the
// rename happens here, never in the reference file.
const HOUSE_RENAMES = {
  OShoppingBD: 'SharkMart',
  OFashion: 'Fashion',
  OBeauty: 'Beauty',
  OFragrance: 'Fragrance',
  OGadgets: 'Gadgets',
  ONature: 'Nature',
  OHome: 'Home',
  OFood: 'Food',
  OBooks: 'Books',
};

/** Reference brand name -> shipped brand name. Unknown names pass through. */
const brandName = (name) => HOUSE_RENAMES[name] ?? name;

/** Reference brand name -> url slug. Derived from the renamed value. */
const brandSlug = (name) =>
  brandName(name)
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');


// ─── T (i18n) ────────────────────────────────────────────────────────────
const T = eval('(' + grab('const T=', '\n/* state */').replace(/;\s*$/, '') + ')');
const tEn = T.en;
const tBn = T.bn;

// ─── Products: reproduce the reference generator exactly ─────────────────
// oshoppingbd.html line 576. Same DISC table, same formula, same order, so
// ids/prices/ratings/stock match the reference pixel for pixel.
const DISC = [0, 10, 15, 20, 25, 30, 35, 40, 12, 18, 22, 28];
const P = [];
let _id = 1;
for (const c of CATS) {
  for (let i = 0; i < 12; i++) {
    const b = c.items[i % 6].split('|');
    const prem = i >= 6;
    const id = _id++;
    const price = Math.round((+b[3] * (prem ? 1.3 : 1)) / 10) * 10;
    const d = DISC[(id * 7 + i) % 12];
    P.push({
      refId: id,
      categoryId: c.id,
      index: i,
      nameEn: (prem ? 'Premium ' : '') + b[0],
      nameBn: (prem ? 'প্রিমিয়াম ' : '') + b[1],
      emoji: b[2],
      priceTaka: price,
      discountPercent: d,
      originalPriceTaka: d ? Math.round(price / (1 - d / 100) / 10) * 10 : 0,
      brandName: brandName(b[4] || c.own),
      rating: Math.min(4.9, +(3.9 + ((id * 37) % 11) / 10).toFixed(1)),
      reviewCount: 12 + ((id * 53) % 480),
      stock: id % 11 === 5 ? 0 : id % 7 === 3 ? 4 : 20 + (id % 40),
      sold: 25 + ((id * 17) % 70),
      sku: 'OSB-' + (1000 + id),
    });
  }
}

// ─── Brand slug map ──────────────────────────────────────────────────────
// `brandName` and `brandSlug` are defined at the top of this file, above the
// product loop, so the product rows can use the same rename map.

const ownBrands = OWN.map((b) => ({
  slug: brandSlug(b.n),
  nameEn: brandName(b.n),
  nameBn: brandName(b.n),
  color: b.c,
  taglineEn: b.e[0],
  taglineBn: b.e[1],
  categoryId: b.cat,
  isOwnBrand: true,
}));

const externalBrands = EXT.map((name) => ({
  slug: brandSlug(name),
  nameEn: name,
  nameBn: name,
  color: null,
  taglineEn: null,
  taglineBn: null,
  categoryId: null,
  isOwnBrand: false,
}));

// The reference's product rows name a few brands that never made it into EXT
// (Easy, Lee Cooper, Johnson's, Axe). Discover them instead of hand-listing,
// so a product can never point at a brand row that does not exist.
const declared = new Set([...ownBrands, ...externalBrands].map((b) => b.slug));
for (const name of new Set(P.map((p) => p.brandName))) {
  const slug = brandSlug(name);
  if (declared.has(slug)) continue;
  declared.add(slug);
  externalBrands.push({
    slug,
    nameEn: name,
    nameBn: name,
    color: null,
    taglineEn: null,
    taglineBn: null,
    categoryId: null,
    isOwnBrand: false,
  });
}

const categories = CATS.map((c, index) => ({
  slug: c.id,
  nameEn: c.en,
  nameBn: c.bn,
  accentColor: c.a,
  lightTintColor: c.t,
  iconEmoji: c.e,
  houseBrand: c.own === 'OShoppingBD' ? 'SharkMart' : c.own,
  sortOrder: index,
  subcategories: c.subs.map((s, si) => {
    const [nameEn, nameBn] = s.split('|');
    return {
      slug: `${c.id}-${brandSlug(nameEn)}`,
      nameEn,
      nameBn,
      sortOrder: si,
    };
  }),
}));

const catalog = {
  _generated: 'tools/extract-reference.mjs from oshoppingbd.html',
  _note:
    'Prices are in TAKA here for readability. The seed converts to integer poisha (x100).',
  categories,
  brands: [...ownBrands, ...externalBrands],
  products: P.map((p) => ({ ...p, brandSlug: brandSlug(p.brandName) })),
};

mkdirSync(resolve(root, 'data'), { recursive: true });
writeFileSync(
  resolve(root, 'data/reference-catalog.json'),
  JSON.stringify(catalog, null, 2) + '\n',
  'utf8',
);

// ─── i18n dictionaries ───────────────────────────────────────────────────
const header = `/**
 * GENERATED from oshoppingbd.html \`const T\` — do not hand-edit.
 * Regenerate with: node tools/extract-reference.mjs
 *
 * Keys are the reference's short names (allcat, add, chk, ...). They are kept
 * verbatim so a string can be traced back to the reference in one grep.
 */
`;

function emit(obj, name) {
  const body = Object.entries(obj)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');
  return `${header}\nexport const ${name} = {\n${body}\n} as const;\n`;
}

/**
 * Brand override — AGENTS.md §2.1.
 *
 * The frozen reference carries the old brand in a handful of strings. We never
 * edit the HTML; we rewrite those strings on the way out, in one place, so no
 * shipped copy can say "OShoppingBD". Anything not listed here passes through
 * untouched, which keeps the override auditable.
 */
const BRAND_REPLACEMENTS = [
  ['OShoppingBD', 'SharkMart'],
  ['ShoppingBD', 'SharkMart'],
  ['OShopping', 'SharkMart'],
];

const applyBrand = (value) => {
  if (typeof value !== 'string') return value;
  return BRAND_REPLACEMENTS.reduce(
    (text, [from, to]) => text.split(from).join(to),
    value,
  );
};

for (const dict of [tEn, tBn]) {
  for (const key of Object.keys(dict)) {
    dict[key] = applyBrand(dict[key]);
  }
}

mkdirSync(resolve(root, 'src/lib/i18n/translations'), { recursive: true });
writeFileSync(resolve(root, 'src/lib/i18n/translations/en.ts'), emit(tEn, 'en'), 'utf8');
writeFileSync(resolve(root, 'src/lib/i18n/translations/bn.ts'), emit(tBn, 'bn'), 'utf8');
// ─── Report ──────────────────────────────────────────────────────────────
const enKeys = Object.keys(tEn);
const bnKeys = Object.keys(tBn);
const missing = enKeys.filter((k) => !(k in tBn));
const extra = bnKeys.filter((k) => !(k in tEn));
console.log(`categories      : ${categories.length}`);
console.log(`subcategories   : ${categories.reduce((n, c) => n + c.subcategories.length, 0)}`);
console.log(`brands          : ${catalog.brands.length} (${ownBrands.length} own, ${externalBrands.length} external)`);
console.log(`products        : ${catalog.products.length}`);
console.log(`i18n en keys    : ${enKeys.length}`);
console.log(`i18n bn keys    : ${bnKeys.length}`);
console.log(`bn missing keys : ${missing.length ? missing.join(', ') : 'none'}`);
console.log(`bn extra keys   : ${extra.length ? extra.join(', ') : 'none'}`);

// Guard: every product's brand must resolve to a real brand slug.
const known = new Set(catalog.brands.map((b) => b.slug));
const orphans = [...new Set(catalog.products.map((p) => p.brandSlug))].filter((s) => !known.has(s));
if (orphans.length) throw new Error(`products reference unknown brands: ${orphans.join(', ')}`);

// Guard: every product's category must exist.
const catIds = new Set(categories.map((c) => c.slug));
const badCats = [...new Set(catalog.products.map((p) => p.categoryId))].filter((s) => !catIds.has(s));
if (badCats.length) throw new Error(`products reference unknown categories: ${badCats.join(', ')}`);

console.log('guards          : OK');
