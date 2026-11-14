/**
 * The shop's written policies — Help, Returns, Privacy, Terms, About.
 *
 * ── Why the copy lives in a data file ──────────────────────────────────────
 *
 * Five pages, two languages, and a dozen numbers that also exist somewhere else
 * in the system. Keeping them as data with a single shape means the four page
 * files are twenty lines each, the renderer is one component, and a change to
 * the return window is a change in one place rather than a hunt through JSX.
 *
 * ── The numbers are not typed here ─────────────────────────────────────────
 *
 * The delivery fee, the free-delivery threshold and the express surcharge are
 * read from `StoreProfile` — the same object checkout charges from. This project
 * has already had four copies of the delivery fee drift apart (AGENTS.md
 * landmine #23); a policy page that quotes ৳60 while checkout charges ৳80 is the
 * same bug wearing a suit. `formatMoney` renders them, so the Bengali page shows
 * the same figure in the same currency.
 *
 * ── What is deliberately not promised ──────────────────────────────────────
 *
 * The payment gateway is a documented stub (README, "Limitations"): a bKash or
 * card order records the transaction id and applies the status, but there is no
 * live call to the provider. The copy therefore says online payment is offered
 * "where the shop has enabled it" instead of promising that a card will be
 * charged. A policy page that describes a capability the code does not have is
 * the kind of thing a customer quotes back at you during a dispute.
 *
 * The policy choices themselves — seven days, 48 hours, 5–7 working days — are
 * the shop's decisions, stated once here. An operator reselling this build edits
 * this file, not the pages.
 */

import { formatMoney } from '@/lib/format';
import type { StoreProfile } from '@/lib/api/public-settings';

export type Lang = 'en' | 'bn';

export interface DocLink {
  label: string;
  href: string;
}

export interface DocSection {
  /** Anchor id — the table of contents links to these. */
  id: string;
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  /** A single highlighted aside, used for the thing people get wrong. */
  note?: string;
  links?: DocLink[];
}

export interface DocContent {
  title: string;
  subtitle: string;
  /** Written out rather than formatted from a Date, so the page never shifts. */
  updated: string;
  sections: DocSection[];
}

/** The date these policies were last reviewed. Edit when the copy changes. */
const LAST_UPDATED_EN = 'Last updated 14 November 2026';
const LAST_UPDATED_BN = 'সর্বশেষ হালনাগাদ: ১৪ নভেম্বর ২০২৬';

// ─── Help & support ────────────────────────────────────────────────────────

export function helpContent(lang: Lang, store: StoreProfile): DocContent {
  const bn = lang === 'bn';
  const standard = formatMoney(store.delivery.feePoisha, lang);
  const free = formatMoney(store.delivery.freeThresholdPoisha, lang);
  const express = formatMoney(store.delivery.expressSurchargePoisha, lang);

  return {
    title: bn ? 'হেল্প ও সাপোর্ট' : 'Help & support',
    subtitle: bn
      ? 'অর্ডার, ডেলিভারি, পেমেন্ট আর অ্যাকাউন্ট নিয়ে সব উত্তর এক জায়গায়।'
      : 'Answers about orders, delivery, payment and your account — in one place.',
    updated: bn ? LAST_UPDATED_BN : LAST_UPDATED_EN,
    sections: [
      {
        id: 'track',
        heading: bn ? 'আমার অর্ডার কোথায়?' : 'Where is my order?',
        paragraphs: [
          bn
            ? 'অর্ডার নম্বর আর যে মোবাইল নম্বর দিয়ে অর্ডার করেছিলেন, সেটি দিয়ে যেকোনো সময় অর্ডারের অবস্থা দেখতে পারবেন। অ্যাকাউন্ট না থাকলেও চলবে।'
            : 'Track any order with its order number and the phone number you used at checkout. You do not need an account.',
        ],
        links: [{ label: bn ? 'অর্ডার ট্র্যাক করুন' : 'Track your order', href: '/track' }],
        note: bn
          ? 'অর্ডার নম্বরটি এসএমএস-এ পাঠানো হয় এবং অর্ডার কনফার্মেশন পাতায়ও থাকে।'
          : 'Your order number is in the confirmation page and the SMS we send when the order is placed.',
      },
      {
        id: 'order',
        heading: bn ? 'অর্ডার কীভাবে করবেন' : 'How to place an order',
        bullets: bn
          ? [
              'পছন্দের পণ্য খুঁজে “কার্টে যোগ করুন” চাপুন।',
              'কার্ট খুলে পরিমাণ মিলিয়ে নিন, তারপর চেকআউটে যান।',
              'নাম, মোবাইল নম্বর ও সম্পূর্ণ ঠিকানা দিন — থানা ও এলাকাসহ।',
              'পেমেন্ট পদ্ধতি বেছে নিয়ে অর্ডার নিশ্চিত করুন।',
            ]
          : [
              'Find the product and add it to your cart.',
              'Check the quantities in the cart, then continue to checkout.',
              'Give your name, mobile number and a full address — including area and district.',
              'Choose a payment method and confirm the order.',
            ],
        note: bn
          ? 'ঠিকানা যত নির্ভুল হবে, ডেলিভারি তত দ্রুত। এলাকা বা থানার নাম বাদ দিলে কুরিয়ার ফোন করে জিজ্ঞেস করতে হয়, তাতে এক দিন বেশি লাগে।'
          : 'A precise address is the single biggest thing you can do to speed up delivery. A missing area name means the courier has to call and ask, which usually costs a day.',
      },
      {
        id: 'delivery',
        heading: bn ? 'ডেলিভারি খরচ ও সময়' : 'Delivery cost and timing',
        bullets: bn
          ? [
              `স্ট্যান্ডার্ড ডেলিভারি: ${standard}।`,
              `${free} বা তার বেশি অর্ডারে ডেলিভারি ফ্রি।`,
              `এক্সপ্রেস ডেলিভারিতে অতিরিক্ত ${express}।`,
              'ঢাকার ভেতরে সাধারণত ১–২ কর্মদিবস, ঢাকার বাইরে ২–৫ কর্মদিবস।',
            ]
          : [
              `Standard delivery: ${standard}.`,
              `Free delivery on orders of ${free} or more.`,
              `Express delivery adds ${express}.`,
              'Usually 1–2 working days inside Dhaka, 2–5 working days outside Dhaka.',
            ],
        note: bn
          ? 'ছুটির দিন, বন্যা বা কুরিয়ার স্টেশনে জটিলতায় সময় কিছুটা বাড়তে পারে। দেরি হলে আমরা ফোনে জানাব।'
          : 'Public holidays, flooding and courier backlogs can add a day or two. If that happens we call you rather than leave you guessing.',
      },
      {
        id: 'payment',
        heading: bn ? 'পেমেন্ট' : 'Payment',
        paragraphs: [
          bn
            ? 'ক্যাশ অন ডেলিভারি সব অর্ডারেই পাওয়া যায় — পণ্য হাতে পেয়ে টাকা দিতে পারবেন। দোকান যে যে অনলাইন পেমেন্ট চালু করেছে (বিকাশ, নগদ, কার্ড), সেগুলো চেকআউটেই দেখা যাবে।'
            : 'Cash on delivery is available on every order — you pay when the parcel is in your hands. Any online payment the shop has enabled (bKash, Nagad, card) appears as an option at checkout.',
        ],
        note: bn
          ? 'আমরা কখনোই আপনার কার্ড নম্বর, পিন বা ওটিপি চাই না — ফোনে, এসএমএসে বা মেসেজে কেউ চাইলেও দেবেন না।'
          : 'We never ask for your card number, PIN or OTP. If someone asks for them by phone, SMS or message, it is not us.',
      },
      {
        id: 'account',
        heading: bn ? 'অ্যাকাউন্ট ও পাসওয়ার্ড' : 'Your account',
        bullets: bn
          ? [
              'অ্যাকাউন্ট না খুলেও অর্ডার করা যায়।',
              `পাসওয়ার্ড ভুলে গেলে ${store.phone} নম্বরে ফোন করুন — আমরা অ্যাকাউন্টটি ফিরিয়ে দিতে সাহায্য করব।`,
              'নিজের প্রোফাইল থেকে ঠিকানা ও ফোন নম্বর বদলাতে পারবেন।',
            ]
          : [
              'You can order without an account.',
              `Forgotten your password? Call us on ${store.phone} and we will help you back into your account.`,
              'Addresses and phone numbers can be edited from your profile at any time.',
            ],
        links: [{ label: bn ? 'আমার অ্যাকাউন্ট' : 'Your account', href: '/profile' }],
      },
      {
        id: 'problem',
        heading: bn ? 'সমস্যা হলে' : 'Something went wrong',
        paragraphs: [
          bn
            ? 'পণ্য ভাঙা, ভুল পণ্য বা অর্ডার না পেলে ৪৮ ঘণ্টার মধ্যে আমাদের জানান। অর্ডার নম্বর আর পণ্যের ছবি সাথে রাখলে দ্রুত সমাধান হয়।'
            : 'If a parcel arrives damaged, contains the wrong item, or never arrives, tell us within 48 hours. Have the order number and a photo ready — it is the difference between a replacement in two days and a week of questions.',
        ],
        links: [
          { label: bn ? 'রিটার্ন ও রিফান্ড নীতি' : 'Return & refund policy', href: '/return' },
        ],
        note: bn
          ? `সরাসরি যোগাযোগ: ${store.phone} · ${store.supportEmail}`
          : `Reach us directly: ${store.phone} · ${store.supportEmail}`,
      },
    ],
  };
}

// ─── Return & refund ───────────────────────────────────────────────────────

export function returnContent(lang: Lang, store: StoreProfile): DocContent {
  const bn = lang === 'bn';

  return {
    title: bn ? 'রিটার্ন ও রিফান্ড নীতি' : 'Return & refund policy',
    subtitle: bn
      ? 'পণ্য পছন্দ না হলে বা সমস্যা থাকলে কী করবেন, আর টাকা কখন ফেরত পাবেন।'
      : 'What to do when something is wrong, and when the money comes back.',
    updated: bn ? LAST_UPDATED_BN : LAST_UPDATED_EN,
    sections: [
      {
        id: 'window',
        heading: bn ? 'কত দিনের মধ্যে ফেরত' : 'The return window',
        paragraphs: [
          bn
            ? 'পণ্য হাতে পাওয়ার ৭ দিনের মধ্যে রিটার্নের অনুরোধ করতে পারবেন। পণ্যটি অব্যবহৃত, অক্ষত এবং আসল প্যাকেজিং ও ট্যাগসহ থাকতে হবে।'
            : 'You can request a return within 7 days of receiving the parcel. The item must be unused, undamaged, and in its original packaging with any tags still attached.',
        ],
        note: bn
          ? '৭ দিন পর আমরা সাধারণত রিটার্ন নিই না — তবে পণ্যে উৎপাদন ত্রুটি থাকলে ওয়ারেন্টি বা সার্ভিসের জন্য আলাদাভাবে যোগাযোগ করতে পারবেন।'
          : 'After 7 days we normally cannot accept a return — but a manufacturing fault is a warranty matter, and you can still contact us about it.',
      },
      {
        id: 'eligible',
        heading: bn ? 'কোন পণ্য ফেরত নেওয়া হয়' : 'What we accept',
        bullets: bn
          ? [
              'ভাঙা, ফাটা বা ক্ষতিগ্রস্ত পণ্য।',
              'ভুল পণ্য বা ভুল সাইজ/ভ্যারিয়েন্ট পাঠানো হয়েছে।',
              'যে পণ্য বর্ণনার সাথে মেলে না (রং, মডেল, পরিমাণ)।',
              'অব্যবহৃত পণ্য, আসল প্যাকেজিংসহ, ৭ দিনের মধ্যে।',
            ]
          : [
              'A damaged or broken item.',
              'The wrong item, size or variant was sent.',
              'An item materially different from its description (colour, model, quantity).',
              'An unused item in its original packaging, within 7 days.',
            ],
      },
      {
        id: 'not-eligible',
        heading: bn ? 'যা ফেরত নেওয়া যায় না' : 'What we cannot take back',
        bullets: bn
          ? [
              'খোলা বা ব্যবহৃত খাদ্য, পানীয় ও কসমেটিকস।',
              'অন্তর্বাস, মোজা ও ব্যক্তিগত স্বাস্থ্যপণ্য (স্বাস্থ্যবিধির কারণে)।',
              'ব্যবহৃত, ধোয়া বা অ্যালটার করা পোশাক।',
              'ডাউনলোড করা বা সক্রিয় করা সফটওয়্যার, গিফট কার্ড ও ডিজিটাল পণ্য।',
              'যে পণ্যে স্পষ্টভাবে “ফেরতযোগ্য নয়” লেখা আছে।',
            ]
          : [
              'Opened or used food, drink and cosmetics.',
              'Innerwear, socks and personal hygiene products, for hygiene reasons.',
              'Clothing that has been worn, washed or altered.',
              'Activated software, gift cards and other digital goods.',
              'Anything explicitly marked "not returnable" on its product page.',
            ],
      },
      {
        id: 'how',
        heading: bn ? 'কীভাবে রিটার্ন করবেন' : 'How to start a return',
        bullets: bn
          ? [
              `আমাদের ফোন করুন ${store.phone} অথবা ইমেইল করুন ${store.supportEmail}-এ।`,
              'অর্ডার নম্বর, পণ্যের নাম ও সমস্যাটি লিখুন।',
              'সম্ভব হলে পণ্য ও প্যাকেজিংয়ের ছবি পাঠান।',
              'আমরা ১ কর্মদিবসের মধ্যে জানাব কীভাবে পণ্যটি ফেরত পাঠাবেন।',
            ]
          : [
              `Call us on ${store.phone} or email ${store.supportEmail}.`,
              'Include the order number, the item, and what is wrong with it.',
              'Attach a photo of the item and the packaging if you can.',
              'We reply within one working day with how to send it back.',
            ],
        note: bn
          ? 'পণ্য ফেরত পাঠানোর আগে অনুমোদন নিন। অনুমোদন ছাড়া পাঠানো পণ্য আমরা ফেরত নিতে পারি না, কারণ কুরিয়ার সেটি শনাক্ত করতে পারে না।'
          : 'Wait for our go-ahead before shipping anything back. A parcel that arrives without a return reference cannot be matched to your order.',
      },
      {
        id: 'refund',
        heading: bn ? 'টাকা কখন ফেরত পাবেন' : 'When the refund arrives',
        paragraphs: [
          bn
            ? 'পণ্য আমাদের কাছে পৌঁছার পর ১–২ কর্মদিবসের মধ্যে যাচাই করা হয়। অনুমোদনের পর ৫–৭ কর্মদিবসের মধ্যে টাকা ফেরত দেওয়া হয়।'
            : 'Once the item reaches us we inspect it within 1–2 working days. After approval the money is returned within 5–7 working days.',
        ],
        bullets: bn
          ? [
              'অনলাইনে পেমেন্ট করলে টাকা সেই পদ্ধতিতেই ফেরত যায়।',
              'ক্যাশ অন ডেলিভারিতে টাকা বিকাশ বা নগদে ফেরত দেওয়া হয়।',
              'ভুল বা ক্ষতিগ্রস্ত পণ্যের ক্ষেত্রে রিটার্ন ডেলিভারি খরচ আমরা বহন করি।',
              'অন্যথায় রিটার্ন খরচ ক্রেতাকে বহন করতে হয়, অথবা রিফান্ড থেকে কেটে নেওয়া হয়।',
            ]
          : [
              'Paid online? The refund goes back the same way it came.',
              'Paid cash on delivery? We refund by bKash or Nagad.',
              'For a wrong or damaged item, we pay the return delivery cost.',
              'Otherwise the return cost is yours, or it is deducted from the refund.',
            ],
      },
      {
        id: 'replacement',
        heading: bn ? 'রিফান্ডের বদলে বদল' : 'Replacement instead of a refund',
        paragraphs: [
          bn
            ? 'চাইলে টাকা ফেরতের বদলে একই পণ্য বদলে নিতে পারেন — স্টকে থাকলে সাধারণত এটি দ্রুততর।'
            : 'If you prefer, we can send a replacement instead of refunding — usually faster when the item is in stock.',
        ],
      },
    ],
  };
}

// ─── Privacy ───────────────────────────────────────────────────────────────

export function privacyContent(lang: Lang, store: StoreProfile): DocContent {
  const bn = lang === 'bn';

  return {
    title: bn ? 'প্রাইভেসি পলিসি' : 'Privacy policy',
    subtitle: bn
      ? 'আমরা কী তথ্য নিই, কেন নিই, কার সাথে ভাগ করি — আর আপনি কী নিয়ন্ত্রণ করতে পারেন।'
      : 'What we collect, why, who we share it with, and what you can control.',
    updated: bn ? LAST_UPDATED_BN : LAST_UPDATED_EN,
    sections: [
      {
        id: 'collect',
        heading: bn ? 'আমরা কী তথ্য সংগ্রহ করি' : 'What we collect',
        bullets: bn
          ? [
              'অর্ডার দিতে যা লাগে: নাম, মোবাইল নম্বর, ডেলিভারি ঠিকানা।',
              'অ্যাকাউন্ট খুললে ইমেইল ও এনক্রিপ্ট করা পাসওয়ার্ড (আমরা পাসওয়ার্ড পড়তে পারি না)।',
              'আপনার অর্ডারের ইতিহাস, কার্ট ও উইশলিস্ট।',
              'সাইট ব্যবহারের সাধারণ তথ্য: কোন পাতা দেখেছেন, ডিভাইস ও ব্রাউজারের ধরন।',
            ]
          : [
              'What an order needs: your name, mobile number and delivery address.',
              'If you create an account: your email and a hashed password — we cannot read your password.',
              'Your order history, cart and wishlist.',
              'Basic usage data: which pages were viewed, and your device and browser type.',
            ],
        note: bn
          ? 'আমরা আপনার কার্ড নম্বর বা মোবাইল ব্যাংকিং পিন কখনোই সংরক্ষণ করি না। অনলাইন পেমেন্ট সরাসরি পেমেন্ট প্রদানকারীর মাধ্যমে হয়।'
          : 'We never store your card number or mobile-wallet PIN. Online payments are handled by the payment provider, not by us.',
      },
      {
        id: 'why',
        heading: bn ? 'কেন ব্যবহার করি' : 'Why we use it',
        bullets: bn
          ? [
              'অর্ডার প্রক্রিয়া করা, প্যাক করা ও ডেলিভারি দেওয়া।',
              'অর্ডার সম্পর্কে আপনাকে ফোন বা এসএমএসে জানানো।',
              'প্রশ্নের উত্তর দেওয়া ও রিটার্ন প্রক্রিয়া করা।',
              'প্রতারণা ও অবৈধ কার্যক্রম প্রতিরোধ করা।',
              'সাইট ও সার্ভিস উন্নত করা।',
            ]
          : [
              'To process, pack and deliver your order.',
              'To tell you about your order by phone or SMS.',
              'To answer your questions and handle returns.',
              'To prevent fraud and abuse.',
              'To improve the site and the service.',
            ],
      },
      {
        id: 'cookies',
        heading: bn ? 'কুকি' : 'Cookies',
        paragraphs: [
          bn
            ? 'সাইট চালাতে কিছু কুকি দরকার — লগইন সেশন, কার্ট, ভাষার পছন্দ এবং ফর্ম জমা দেওয়ার নিরাপত্তা (CSRF)। এগুলো ছাড়া কার্ট বা লগইন কাজ করবে না।'
            : 'The site needs a few cookies to work: your sign-in session, your cart, your language choice, and the security token that protects form submissions (CSRF). Without them the cart and sign-in cannot function.',
        ],
        note: bn
          ? 'ব্রাউজার থেকে কুকি মুছে দিলে কার্ট ও লগইন সেশন হারিয়ে যাবে।'
          : 'Clearing cookies in your browser will empty your cart and sign you out.',
      },
      {
        id: 'sharing',
        heading: bn ? 'কার সাথে ভাগ করি' : 'Who we share it with',
        bullets: bn
          ? [
              'কুরিয়ার — শুধু নাম, ফোন নম্বর ও ঠিকানা, ডেলিভারির জন্য।',
              'পেমেন্ট প্রদানকারী — লেনদেনের পরিমাণ ও রেফারেন্স, কার্ডের তথ্য নয়।',
              'আইন অনুযায়ী প্রয়োজন হলে সংশ্লিষ্ট কর্তৃপক্ষ।',
            ]
          : [
              'The courier — name, phone and address only, so the parcel can be delivered.',
              'The payment provider — the amount and a transaction reference, never your card details.',
              'Authorities, where the law requires it.',
            ],
        note: bn
          ? 'আমরা কোনো অবস্থাতেই আপনার তথ্য বিক্রি করি না, ভাড়া দিই না বা বিজ্ঞাপনদাতার কাছে দিই না।'
          : 'We do not sell, rent or trade your information to anyone.',
      },
      {
        id: 'retention',
        heading: bn ? 'কত দিন রাখি' : 'How long we keep it',
        paragraphs: [
          bn
            ? 'অর্ডারের রেকর্ড হিসাবরক্ষণের জন্য রাখা হয়, কারণ ট্যাক্স ও হিসাবের প্রয়োজনে সেগুলো লাগে। অ্যাকাউন্টের তথ্য আপনার অনুরোধে মুছে দেওয়া হয়, তবে চলমান অর্ডার ও আইনি বাধ্যবাধকতা শেষ হওয়ার পর।'
            : 'Order records are kept for accounting, because tax and bookkeeping require them. Account details are deleted on request, once any open order and legal obligation has been settled.',
        ],
      },
      {
        id: 'rights',
        heading: bn ? 'আপনার অধিকার' : 'Your choices',
        bullets: bn
          ? [
              'আপনার কী তথ্য আছে জানতে চাইতে পারেন।',
              'ভুল তথ্য সংশোধন করতে পারেন — প্রোফাইল থেকেই বেশিরভাগ।',
              'অ্যাকাউন্ট মুছে ফেলার অনুরোধ করতে পারেন।',
              'মার্কেটিং এসএমএস বন্ধ করতে বলতে পারেন।',
            ]
          : [
              'Ask what information we hold about you.',
              'Correct anything wrong — most of it from your profile.',
              'Ask us to delete your account.',
              'Ask us to stop marketing SMS.',
            ],
        note: bn
          ? `অনুরোধ করতে: ${store.supportEmail} অথবা ${store.phone}।`
          : `To make a request: ${store.supportEmail} or ${store.phone}.`,
      },
      {
        id: 'security',
        heading: bn ? 'নিরাপত্তা' : 'Security',
        paragraphs: [
          bn
            ? 'পাসওয়ার্ড হ্যাশ করে রাখা হয়, সেশন কুকি জাভাস্ক্রিপ্ট থেকে পড়া যায় না (httpOnly), আর সাইটের সাথে যোগাযোগ এনক্রিপ্টেড (HTTPS)। কোনো সিস্টেমই শতভাগ নিরাপদ নয়, তবে আমরা ঝুঁকি কমাতে চেষ্টা করি এবং সন্দেহজনক কিছু দেখলে দ্রুত ব্যবস্থা নিই।'
            : 'Passwords are hashed, session cookies cannot be read by JavaScript (httpOnly), and traffic to the site is encrypted (HTTPS). No system is perfectly secure, but we work to keep the risk low and act quickly when something looks wrong.',
        ],
      },
      {
        id: 'changes',
        heading: bn ? 'নীতিতে পরিবর্তন' : 'Changes to this policy',
        paragraphs: [
          bn
            ? 'নীতি বদলালে এই পাতায় নতুন তারিখ দিয়ে প্রকাশ করা হবে। উল্লেখযোগ্য পরিবর্তন হলে অর্ডার করা নম্বরে এসএমএস পাঠানো হবে।'
            : 'If this policy changes, the new version appears here with a new date. For a significant change we also send an SMS to the number on your order.',
        ],
      },
    ],
  };
}

// ─── Terms ─────────────────────────────────────────────────────────────────

export function termsContent(lang: Lang, store: StoreProfile): DocContent {
  const bn = lang === 'bn';

  return {
    title: bn ? 'শর্তাবলি' : 'Terms & conditions',
    subtitle: bn
      ? 'এই সাইট ব্যবহার করার শর্ত — সংক্ষেপে, স্পষ্ট ভাষায়।'
      : 'The terms you agree to when you use this site — short, and in plain language.',
    updated: bn ? LAST_UPDATED_BN : LAST_UPDATED_EN,
    sections: [
      {
        id: 'acceptance',
        heading: bn ? 'শর্ত মেনে নেওয়া' : 'Acceptance',
        paragraphs: [
          bn
            ? `${store.name} সাইট ব্যবহার করে বা অর্ডার করে আপনি এই শর্তগুলো মেনে নিচ্ছেন। না মেনে থাকলে সাইটটি ব্যবহার করা থেকে বিরত থাকুন।`
            : `By using ${store.name} or placing an order you accept these terms. If you do not accept them, please do not use the site.`,
        ],
      },
      {
        id: 'orders',
        heading: bn ? 'অর্ডার ও গ্রহণ' : 'Orders and acceptance',
        paragraphs: [
          bn
            ? 'আপনার অর্ডার একটি প্রস্তাব। আমরা যখন অর্ডার নিশ্চিত করি — সাধারণত এসএমএস বা ফোনে — তখনই এটি আমাদের সাথে চুক্তি হয়।'
            : 'Your order is an offer. It becomes a contract with us when we confirm it, usually by SMS or a phone call.',
        ],
        bullets: bn
          ? [
              'স্টক না থাকলে বা দামে স্পষ্ট ভুল থাকলে আমরা অর্ডার বাতিল করতে পারি।',
              'বাতিল হলে টাকা সম্পূর্ণ ফেরত দেওয়া হয়।',
              'সন্দেহজনক বা প্রতারণামূলক মনে হলে আমরা অর্ডার নাও নিতে পারি।',
            ]
          : [
              'We may cancel an order if the item is out of stock or the price was clearly wrong.',
              'If we cancel, you are refunded in full.',
              'We may decline an order that looks fraudulent.',
            ],
      },
      {
        id: 'pricing',
        heading: bn ? 'দাম ও পণ্যের তথ্য' : 'Prices and product information',
        bullets: bn
          ? [
              'সব দাম বাংলাদেশি টাকায় এবং প্রযোজ্য ভ্যাটসহ দেখানো হয়।',
              'দাম আগে নোটিশ ছাড়াই বদলাতে পারে; অর্ডার নিশ্চিত হওয়ার পর দাম বদলায় না।',
              'পণ্যের ছবি নমুনা হিসেবে দেখানো হয় — রঙ বা প্যাকেজিং সামান্য আলাদা হতে পারে।',
            ]
          : [
              'All prices are in Bangladeshi Taka and include applicable VAT.',
              'Prices can change without notice, but never after your order is confirmed.',
              'Product photographs are representative — colour and packaging can vary slightly.',
            ],
      },
      {
        id: 'payment',
        heading: bn ? 'পেমেন্ট' : 'Payment',
        paragraphs: [
          bn
            ? 'ক্যাশ অন ডেলিভারি এবং দোকানের চালু থাকা অনলাইন পেমেন্ট পদ্ধতি গ্রহণ করা হয়। অনলাইন পেমেন্ট ব্যর্থ হলে অর্ডারটি অপরিশোধিত থাকবে এবং পণ্য পাঠানো হবে না।'
            : 'We accept cash on delivery and any online payment method the shop has enabled. If an online payment fails, the order stays unpaid and is not dispatched.',
        ],
      },
      {
        id: 'delivery',
        heading: bn ? 'ডেলিভারি' : 'Delivery',
        bullets: bn
          ? [
              'ডেলিভারির সময়সীমা একটি অনুমান, নিশ্চয়তা নয়।',
              'পণ্য হাতে পাওয়ার সাথে সাথে এর দায়িত্ব আপনার।',
              'পণ্য গ্রহণ করতে না পারলে কুরিয়ার আবার চেষ্টা করবে; বারবার ব্যর্থ হলে অর্ডার ফেরত আসবে।',
            ]
          : [
              'Delivery times are an estimate, not a guarantee.',
              'Risk in the goods passes to you when the parcel is handed over.',
              'If you cannot receive a delivery, the courier will try again; repeated failures return the parcel to us.',
            ],
      },
      {
        id: 'returns',
        heading: bn ? 'রিটার্ন' : 'Returns',
        paragraphs: [
          bn
            ? 'রিটার্ন ও রিফান্ড আমাদের আলাদা নীতিতে বলা আছে, যা এই শর্তের অংশ।'
            : 'Returns and refunds are governed by our separate policy, which forms part of these terms.',
        ],
        links: [
          { label: bn ? 'রিটার্ন ও রিফান্ড নীতি' : 'Return & refund policy', href: '/return' },
        ],
      },
      {
        id: 'accounts',
        heading: bn ? 'অ্যাকাউন্ট' : 'Your account',
        bullets: bn
          ? [
              'তথ্য সঠিক রাখার দায়িত্ব আপনার।',
              'পাসওয়ার্ড গোপন রাখুন; আপনার অ্যাকাউন্টে যা হয় তার দায়িত্ব আপনার।',
              'নিয়ম ভাঙলে আমরা অ্যাকাউন্ট বন্ধ করতে পারি।',
            ]
          : [
              'You are responsible for keeping your details accurate.',
              'Keep your password private; activity on your account is your responsibility.',
              'We may close an account that breaks these terms.',
            ],
      },
      {
        id: 'ip',
        heading: bn ? 'মালিকানা' : 'Intellectual property',
        paragraphs: [
          bn
            ? 'এই সাইটের লেখা, ছবি, লোগো ও ডিজাইন আমাদের বা আমাদের সরবরাহকারীর। অনুমতি ছাড়া বাণিজ্যিকভাবে ব্যবহার করা যাবে না।'
            : 'The text, images, logo and design of this site belong to us or our suppliers. They may not be used commercially without permission.',
        ],
      },
      {
        id: 'liability',
        heading: bn ? 'দায়সীমা' : 'Limitation of liability',
        paragraphs: [
          bn
            ? 'আইন যতটা অনুমোদন করে, আমাদের দায় অর্ডারের মূল্যের মধ্যে সীমাবদ্ধ। পরোক্ষ ক্ষতি — যেমন ব্যবসার ক্ষতি বা হারানো লাভ — এর জন্য আমরা দায়ী নই।'
            : 'To the extent the law allows, our liability is limited to the value of the order. We are not liable for indirect losses such as lost business or lost profit.',
        ],
      },
      {
        id: 'law',
        heading: bn ? 'প্রযোজ্য আইন' : 'Governing law',
        paragraphs: [
          bn
            ? 'এই শর্ত বাংলাদেশের আইন দ্বারা পরিচালিত। বিরোধ হলে ঢাকার আদালতের এখতিয়ার থাকবে।'
            : 'These terms are governed by the laws of Bangladesh, and the courts of Dhaka have jurisdiction over any dispute.',
        ],
      },
      {
        id: 'contact',
        heading: bn ? 'যোগাযোগ' : 'Contact',
        paragraphs: [
          bn
            ? `${store.name} · ${store.address} · ${store.phone} · ${store.supportEmail}`
            : `${store.name} · ${store.address} · ${store.phone} · ${store.supportEmail}`,
        ],
      },
    ],
  };
}

// ─── About ─────────────────────────────────────────────────────────────────

export function aboutContent(lang: Lang, store: StoreProfile): DocContent {
  const bn = lang === 'bn';

  return {
    title: bn ? 'আমাদের সম্পর্কে' : 'About us',
    subtitle: bn
      ? `${store.name} — বাংলাদেশের একটি মাল্টি-ক্যাটাগরি অনলাইন শপ।`
      : `${store.name} — a multi-category online shop in Bangladesh.`,
    updated: bn ? LAST_UPDATED_BN : LAST_UPDATED_EN,
    sections: [
      {
        id: 'who',
        heading: bn ? 'আমরা কারা' : 'Who we are',
        paragraphs: [
          bn
            ? `${store.name} একটি অনলাইন শপ, যেখানে নিত্যপ্রয়োজনীয় জিনিস থেকে শুরু করে ইলেকট্রনিকস, ফ্যাশন ও হোম ফার্নিচার — সব এক জায়গায়। আমরা ঢাকা থেকে কাজ করি এবং সারা বাংলাদেশে ডেলিভারি দিই।`
            : `${store.name} is an online shop that brings everyday essentials, electronics, fashion and home goods into one place. We work out of Dhaka and deliver across Bangladesh.`,
        ],
      },
      {
        id: 'promise',
        heading: bn ? 'আমাদের প্রতিশ্রুতি' : 'What we promise',
        bullets: bn
          ? [
              'যে দাম দেখবেন, সেটাই দেবেন — লুকানো চার্জ নেই।',
              'স্টকে না থাকলে আগেই জানাব, অর্ডার নিয়ে ঝুলিয়ে রাখব না।',
              'সমস্যা হলে ফোনেই কথা বলতে পারবেন।',
            ]
          : [
              'The price you see is the price you pay — no hidden charges at the door.',
              'If something is out of stock we say so, instead of taking the order and stalling.',
              'When something goes wrong you can reach a person on the phone.',
            ],
      },
      {
        id: 'contact',
        heading: bn ? 'যোগাযোগ' : 'Get in touch',
        paragraphs: [
          bn
            ? `${store.address} · ${store.phone} · ${store.supportEmail}`
            : `${store.address} · ${store.phone} · ${store.supportEmail}`,
        ],
        links: [
          { label: bn ? 'হেল্প ও সাপোর্ট' : 'Help & support', href: '/help' },
          { label: bn ? 'রিটার্ন নীতি' : 'Return policy', href: '/return' },
        ],
      },
    ],
  };
}
