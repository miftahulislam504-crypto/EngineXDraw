'use client';

import { useEffect, useState } from 'react';
import { onSnapshotsInSync } from 'firebase/firestore';
import { db } from './firebase-client';

export type NetworkStatus = 'offline' | 'syncing' | 'synced';

/**
 * Phase 10 — "Auto Synchronization" (item 21) / "Offline Mode" (item 24).
 *
 * @archibim/firebase-config has enabled Firestore's persistentLocalCache
 * with multi-tab IndexedDB persistence since Phase 1 — writes made while
 * offline already queue locally and flush automatically once the
 * connection returns; nothing in that mechanism is new here. What WAS
 * missing, until this pass, was any visible indication of it — a person
 * offline for a while had no way to tell "my edits are saved locally and
 * will sync" from "something is broken." This hook is that missing
 * signal, not a new sync engine.
 *
 * Honest limitation on the 'syncing' state: the Firestore Web SDK doesn't
 * expose a global "N pending writes" counter (only per-document listener
 * metadata, `snapshot.metadata.hasPendingWrites`, which would need
 * instrumenting every single subscription in the app to aggregate). This
 * hook approximates it instead: browser 'offline'/'online' events drive
 * the offline/syncing transition, and Firestore's onSnapshotsInSync —
 * which fires once the client has finished reconciling everything it
 * currently knows about with the server — clears back to 'synced'. That
 * covers the common case (reconnecting after a period offline) correctly
 * without claiming a precision the underlying API doesn't provide.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'synced',
  );

  useEffect(() => {
    function handleOffline() {
      setStatus('offline');
    }
    function handleOnline() {
      setStatus('syncing');
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    const unsubSync = onSnapshotsInSync(db, () => {
      setStatus((prev) => (prev === 'offline' ? prev : 'synced'));
    });

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      unsubSync();
    };
  }, []);

  return status;
}
