'use client';

// TEMPORARY debugging aid — safe to delete once the Floor Plan / Site
// Plan crash (React error #185, "Maximum update depth exceeded") is
// found and fixed. Not linked from anywhere and adds no bundle weight
// to normal pages; it only renders when Next.js's root error boundary
// catches an unrecoverable render error, which is exactly the crash
// we're chasing.
//
// Why this shows more than the browser console does: production
// builds minify error MESSAGES for logging (hence "React error #185"),
// but the `error` object handed to this boundary is unminified. Its
// `.message` and `.stack` here are the real thing — no DevTools or
// desktop browser needed to read them.
export default function GlobalError({
  error,
}: {
  error: Error & { digest ? : string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 16,
          fontFamily: 'monospace',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#fff',
          color: '#111',
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Debug: caught error</h2>

        <div style={{ marginBottom: 12 }}>
          <strong>message:</strong>
          {'\n'}
          {error?.message || '(no message)'}
        </div>

        {error?.digest && (
          <div style={{ marginBottom: 12 }}>
            <strong>digest:</strong>
            {'\n'}
            {error.digest}
          </div>
        )}

        <div>
          <strong>stack:</strong>
          {'\n'}
          {error?.stack || '(no stack)'}
        </div>
      </body>
    </html>
  );
}