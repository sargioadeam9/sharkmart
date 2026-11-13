import type { Metadata, Viewport } from 'next';
import { BRAND, SITE_URL } from '@/lib/brand';
import { Toaster } from '@/components/shared/toast';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s | ${BRAND.name}`,
  },
  description: `${BRAND.name} — Bangladesh’s multi-category online shop. Fashion, gadgets, grocery, beauty and more, with cash on delivery and fast delivery nationwide.`,
  applicationName: BRAND.name,
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description:
      'Bangladesh’s multi-category online shop. Cash on delivery, fast delivery nationwide.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.name} — ${BRAND.tagline}`,
  },
  /**
   * The tab icon. A file, not a setting: Next serves it statically, and a
   * resold install replaces `public/brand/icon.png` rather than editing code.
   * (A 512px source is fine here; browsers downscale. Replace it per client.)
   */
  icons: {
    icon: [{ url: '/brand/icon.png', type: 'image/png' }],
    apple: [{ url: '/brand/icon.png' }],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#c51f4b',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/*
          Fonts loaded exactly as the reference does it, so the visual output
          matches on day one. Migrating to next/font (self-hosted, no external
          request) is a Phase 12 performance task.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
