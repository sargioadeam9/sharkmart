/**
 * Hero slide copy — the reference's `SLIDES` (oshoppingbd.html L568-573).
 *
 * Four slides, each with a bilingual tag / headline / body, a gradient, three
 * decorative emoji and a destination. Kept as data here rather than inline in
 * the component for the same reason the reference keeps it as a constant: the
 * slider renders it, it does not own it.
 *
 * `headline` uses `\n` to mark the reference's intentional line break
 * (`sp(s.h).replace(/\n/g, '<br>')`). The component turns it into a <br>, so
 * the break survives translation instead of being baked into a string.
 *
 * Gradients are copied byte-for-byte from the reference. They are not tokens —
 * they are that slide's identity, and the reference never reuses them.
 */

export interface HeroSlide {
  id: string;
  /** CSS background, straight from the reference. */
  background: string;
  tagEn: string;
  tagBn: string;
  headlineEn: string;
  headlineBn: string;
  bodyEn: string;
  bodyBn: string;
  /** Decorative only — hidden from assistive tech. */
  art: string[];
  href: string;
}

export const HERO_SLIDES: HeroSlide[] = [
  {
    id: 'mega-flash',
    background: 'linear-gradient(110deg,#C51F4B,#e4577d)',
    tagEn: 'Mega Flash Sale',
    tagBn: 'মেগা ফ্ল্যাশ সেল',
    headlineEn: 'Up to 70% off\nthis week only',
    headlineBn: '৭০% পর্যন্ত ছাড়\nশুধু এই সপ্তাহে',
    bodyEn: 'Phones, fashion, kitchen and more. Cash on Delivery everywhere.',
    bodyBn: 'ফোন, ফ্যাশন, কিচেন আরও অনেক কিছু। সারাদেশে ক্যাশ অন ডেলিভারি।',
    art: ['📱', '🛍️', '🎧'],
    href: '/category/gadgets-electronics',
  },
  {
    id: 'herbal',
    background: 'linear-gradient(110deg,#3d7a4a,#7fb06a)',
    tagEn: 'Herbal & Natural',
    tagBn: 'হার্বাল ও ন্যাচারাল',
    headlineEn: 'Pure. Organic.\nStraight from nature.',
    headlineBn: 'খাঁটি, অর্গানিক\nপ্রকৃতি থেকে সরাসরি',
    bodyEn: 'Honey, oils, teas and superfoods from trusted farms.',
    bodyBn: 'বিশ্বস্ত খামার থেকে মধু, তেল, চা ও সুপারফুড।',
    art: ['🍯', '🌿', '🍵'],
    href: '/category/herbal-natural',
  },
  {
    id: 'fashion',
    background: 'linear-gradient(110deg,#a47a55,#d9b99b)',
    tagEn: 'New Arrivals',
    tagBn: 'নতুন কালেকশন',
    headlineEn: 'Fashion that fits\nyour season',
    headlineBn: 'আপনার মৌসুমের\nসেরা ফ্যাশন',
    bodyEn: 'Panjabi, saree, sandals and bags. Fresh styles every week.',
    bodyBn: 'পাঞ্জাবি, শাড়ি, স্যান্ডেল ও ব্যাগ। প্রতি সপ্তাহে নতুন স্টাইল।',
    art: ['👗', '👜', '👡'],
    href: '/category/fashion',
  },
  {
    id: 'gadget-fest',
    background: 'linear-gradient(110deg,#253858,#4f6ea3)',
    tagEn: 'Gadget Fest',
    tagBn: 'গ্যাজেট ফেস্ট',
    headlineEn: 'Smart gadgets.\nSmarter prices.',
    headlineBn: 'স্মার্ট গ্যাজেট\nসাশ্রয়ী দাম',
    bodyEn: 'Watches, earbuds, power banks. Genuine with warranty.',
    bodyBn: 'ওয়াচ, ইয়ারবাড, পাওয়ার ব্যাংক। ওয়ারেন্টিসহ অরিজিনাল।',
    art: ['⌚', '🔋', '🔊'],
    href: '/category/gadgets-electronics',
  },
];
