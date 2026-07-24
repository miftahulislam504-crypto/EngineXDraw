'use client';

import { initArchibimFirebase } from '@archibim/firebase-config';

export const firebaseInstance = initArchibimFirebase({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  useEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true',
});

export const { auth, db, storage, functions } = firebaseInstance;
