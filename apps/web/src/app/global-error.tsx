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
