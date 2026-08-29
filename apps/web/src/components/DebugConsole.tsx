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
    
    // TEMPORARY — chasing the Floor Plan / Site Plan "Maximum update
    // depth exceeded" crash (React error #185). By the time that
    // error is thrown and reaches an error boundary, React has
    // already minified its own message — that's why global-error.tsx
    // only shows "Minified React error #185" even though the `error`
    // object it receives looks like it should be the real thing.
    //
    // But React logs the SAME warning via console.error on every
    // render pass leading up to the 50th one that finally throws —
    // and that console.error call, unlike the eventual thrown
    // Error's message, is NOT minified: it includes the real
    // "Maximum update depth exceeded..." text and (in the array
    // arguments React passes) the actual component stack showing
    // which component's setState call is looping. Overriding
    // console.error here to display the first such message directly
    // on-screen (via a full-page overlay, so it's visible even if the
    // app crashes a few renders later) is the only way to see that
    // real message/stack on a phone with no desktop DevTools access.
    // Safe to remove alongside the rest of this debug-gated block
    // once the crash is found.
    let captured = false;
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      if (!captured && typeof args[0] === 'string' && args[0].includes('Maximum update depth exceeded')) {
        captured = true;
        const overlay = document.createElement('div');
        overlay.style.cssText =
          'position:fixed;inset:0;z-index:999999;background:#fff;color:#111;' +
          'font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;' +
          'padding:16px;overflow:auto;';
        overlay.textContent =
          'CAUGHT (pre-throw, unminified):\n\n' +
          args
          .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)))
          .join('\n\n---\n\n');
        document.body.appendChild(overlay);
      }
      originalConsoleError(...args);
    };
    
    if ((window as unknown as { eruda ? : unknown }).eruda) return;
    
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eruda';
    script.onload = () => {
      (window as unknown as { eruda: { init: () => void } }).eruda.init();
    };
    document.body.appendChild(script);
  }, []);
  
  return null;
}