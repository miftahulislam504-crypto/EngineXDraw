'use client';

import { useEffect } from 'react';

/**
 * Root-level error boundary — ONLY fires if root layout.tsx itself
 * throws (error.tsx can't catch that, since layout.tsx is error.tsx's
 * own parent). layout.tsx currently has almost no logic, so this is
 * unlikely to be the actual source of the Sheets crash (see error.tsx
 * for that, which covers everything layout.tsx renders as {children}),
 * but Next.js requires a global-error.tsx to exist for root-layout
 * crashes to show anything other than an unstyled blank page — so this
 * is a safety net, not the primary fix.
 *
 * Must render its own <html>/<body> — this REPLACES the root layout
 * entirely when it fires, so none of layout.tsx's markup (fonts,
 * DebugConsole, PwaServiceWorker) is available here to reuse.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[EngineXDraw] Uncaught root layout error:', error);

    // A stale-chunk crash isn't a real app bug — it means this tab's
    // already-loaded JS is asking for a file a NEWER deploy has since
    // replaced/removed (Next.js/Vercel call this "version skew"; see
    // sw.js's own cache-first /_next/static/ rule, which can keep
    // serving a stale chunk from a PREVIOUS visit even after the CDN
    // itself has pruned it). reset() can't fix this — it only re-runs
    // React with the SAME stale JS already sitting in memory, which
    // still doesn't have the new deploy's chunk map. The actual fix is
    // a full page reload, which fetches fresh HTML/JS from whichever
    // deploy is live right now.
    //
    // Chrome/Android report this as `ChunkLoadError`; some browsers
    // instead throw a `SyntaxError` while trying to parse Vercel's
    // plain-text 404 body as if it were the requested JS file — same
    // underlying cause, different error name, so both are treated as
    // the same case here.
    const isStaleChunk =
      error.name === 'ChunkLoadError' ||
      (error.name === 'SyntaxError' && /Unexpected token ?<|Unexpected end of input/.test(error.message));

    if (isStaleChunk && typeof window !== 'undefined') {
      // sessionStorage, not a JS variable — a variable would just be
      // wiped out by the reload this triggers, defeating its own
      // purpose. Guards against an infinite reload loop if the
      // deployment itself is genuinely broken (missing chunk that no
      // reload will ever fix): reload once per tab session, then fall
      // through to the normal error screen below on any repeat.
      const alreadyReloaded = window.sessionStorage.getItem('enginexdraw-chunk-reload') === '1';
      if (!alreadyReloaded) {
        window.sessionStorage.setItem('enginexdraw-chunk-reload', '1');
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'monospace', background: '#131B2E', color: '#F5F5F0' }}>
        <div style={{ minHeight: '100vh', padding: '24px 16px' }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>The app itself failed to load</h1>
          <div
            style={{
              background: '#1E293B',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              overflowX: 'auto',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#F87171' }}>
              {error.name || 'Error'}: {error.message || '(no message)'}
            </div>
            {error.digest && <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>digest: {error.digest}</div>}
            {error.stack && (
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, opacity: 0.85 }}>{error.stack}</pre>
            )}
          </div>
          <button
            onClick={() => reset()}
            style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #475569', background: '#1E293B', color: '#F5F5F0' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
