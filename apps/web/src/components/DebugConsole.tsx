'use client';

import { useEffect } from 'react';

/**
 * Loads the Eruda mobile devtools console, but only when the page is
 * visited with `?debug=1` in the URL. Safe to leave in production:
 * normal visitors never trigger the script load. Remove this component
 * (and its usage in layout.tsx) once debugging is done.
 */
export function DebugConsole() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') !== '1') return;
    if ((window as unknown as { eruda?: unknown }).eruda) return;

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eruda';
    script.onload = () => {
      (window as unknown as { eruda: { init: () => void } }).eruda.init();
    };
    document.body.appendChild(script);
  }, []);

  return null;
}
