import type { Metadata } from 'next';
import { Space_Grotesk, Inter, JetBrains_Mono, Noto_Sans_Bengali } from 'next/font/google';
import './globals.css';
import { I18nHydrator } from '@/components/I18nHydrator';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// Space Grotesk / Inter don't cover Bengali glyphs — without this, toggling
// to Bengali would silently fall back to a generic system font instead of
// something that actually matches the rest of the app's typography.
const notoSansBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-bengali',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ArchiBIM Platform',
  description: 'Think the building, not the drawing.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} ${notoSansBengali.variable}`}
      >
        <I18nHydrator />
        {children}
      </body>
    </html>
  );
}
