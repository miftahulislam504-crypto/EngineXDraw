/**
 * Design direction: architectural drafting / blueprint, not generic SaaS.
 *
 * Color  — cool technical paper background, deep graphite-navy ink, a single
 *          "blueprint cyan" accent (blueprints are literally cyan — the
 *          cyanotype print process is where the name comes from), and a
 *          restrained warm signal color for anything that needs to interrupt.
 * Type   — Space Grotesk (display, geometric/technical) + Inter (body) +
 *          JetBrains Mono (IDs, coordinates, project codes — anywhere a
 *          number needs to look exact rather than friendly).
 * Motif  — thin hairline rules over soft shadows; project cards borrow the
 *          title-block convention from real drawing sheets.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        paper: '#F6F7F9',
        surface: '#FFFFFF',
        ink: {
          DEFAULT: '#131B2E',
          muted: '#5B6478',
          faint: '#8B93A7',
        },
        line: '#D8DEE9',
        'line-strong': '#B7C0D1',
        accent: {
          DEFAULT: '#2D6CDF',
          dark: '#1E4FB0',
          soft: '#E8EFFD',
        },
        signal: {
          DEFAULT: '#E8871E',
          soft: '#FDF1E2',
        },
        success: {
          DEFAULT: '#1C8A5E',
          soft: '#E4F5EE',
        },
        danger: {
          DEFAULT: '#C4432B',
          soft: '#FBEAE6',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'var(--font-bengali)', 'sans-serif'],
        body: ['var(--font-body)', 'var(--font-bengali)', 'sans-serif'],
        mono: ['var(--font-mono)', 'var(--font-bengali)', 'monospace'],
      },
      borderRadius: {
        sheet: '2px',
      },
      boxShadow: {
        sheet: '0 1px 2px rgba(19, 27, 46, 0.06)',
      },
    },
  },
};
