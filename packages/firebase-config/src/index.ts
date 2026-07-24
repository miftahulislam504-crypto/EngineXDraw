/**
 * @archibim/firebase-config
 *
 * One initialization point for the Firebase *client* SDK, shared by every
 * app in the monorepo. Never import this from functions/ — Cloud Functions
 * use firebase-admin instead (see functions/src/common/admin.ts).
 */
import { initializeApp, getApps, getApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

export interface ArchibimFirebaseConfig extends FirebaseOptions {
  useEmulators?: boolean;
}

export function initArchibimFirebase(config: ArchibimFirebaseConfig) {
  const app = getApps().length ? getApp() : initializeApp(config);

  const auth = getAuth(app);

  // Firebase Offline Persistence (Phase 1: Cloud Sync / Offline Mode groundwork)
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });

  const storage = getStorage(app);
  const functions = getFunctions(app);

  if (config.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }

  return { app, auth, db, storage, functions };
}

export type ArchibimFirebaseInstance = ReturnType<typeof initArchibimFirebase>;
