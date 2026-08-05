import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Inter, JetBrains_Mono, Noto_Sans_Bengali } from 'next/font/google';
import './globals.css';
import { I18nHydrator } from '@/components/I18nHydrator';
import { DebugConsole } from '@/components/DebugConsole';

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
  title: 'EngineX Draw',
  description: 'Think the building, not the drawing.',
};

// Pins the whole app's page-level zoom at 1x and disables the browser's
// native pinch-to-zoom gesture. Without this, a two-finger pinch meant
// to zoom the Design Studio's drawing canvas (which has its own
// internal zoom, driven by pixelsPerMeter) instead zoomed the entire
// page — toolbar, header and all — leaving the person stuck zoomed in
// on the whole app rather than just the drawing. The canvas keeps its
// own zoom via FloorPlanCanvas's wheel/pinch handling, which works
// against pixelsPerMeter regardless of this page-level lock.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
        <DebugConsole />
        {children}
      </body>
    </html>
  );
}
