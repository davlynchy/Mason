import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mason — Contract Risk Review',
  description: 'AI-powered contract analysis for construction professionals. Know every risk before you sign.',
  icons: {
    icon: '/favicon.png',
  },
  openGraph: {
    title: 'Mason — Contract Risk Review',
    description: 'Know every risk before you sign. AI-powered contract analysis for construction.',
    url: 'https://gomason.ai',
    siteName: 'Mason',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    locale: 'en_AU',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
