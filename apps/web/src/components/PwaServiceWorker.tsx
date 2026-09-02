'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js on mount, making the app installable and giving
 * it an app-shell cache for fast repeat launches (see sw.js for exactly
 * what is/isn't cached — project data itself never is).
 *
 * A no-op outside a real browser context (SSR, or any browser without
 * Service Worker support) and deliberately silent on failure — a failed
 * registration should never surface as a user-facing error in a CAD
 * tool; the app works identically without it, just without the
 * installable/offline-shell benefits.
 */
export function PwaServiceWorker() {
  useEffect(() => {
    // A successful mount means this load's JS actually matches a live
    // deploy — clear global-error.tsx's one-shot stale-chunk reload
    // guard so a LATER stale-chunk error (e.g. after a subsequent
    // deploy, in the same long-lived tab) still gets one reload of its
    // own rather than silently skipping straight to the error screen
    // because an earlier, unrelated recovery already spent the guard.
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('enginexdraw-chunk-reload');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Registered after 'load' rather than immediately, so the service
    // worker's own install/fetch handling never competes with the
    // initial page's own network requests for bandwidth/priority.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Best-effort — see doc comment above.
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
