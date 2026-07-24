'use client';

import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import type { Locale } from '@archibim/object-model';
import { db } from './firebase-client';

/**
 * Cross-device sync for the language toggle. Piggybacks on the existing
 * `users/{uid}` document (already created by the onUserCreate Cloud
 * Function and already covered by firestore.rules — owner-only read/write
 * for signed-in users) rather than introducing a new collection.
 *
 * This only ever reads/writes the single `preferredLocale` field via
 * `setDoc(..., { merge: true })`, so it can't clobber the rest of the
 * profile document (name, email, twoFactorEnabled, etc.).
 */

export function subscribeToPreferredLocale(
  uid: string,
  onChange: (locale: Locale | null) => void,
) {
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    const value = snap.data()?.preferredLocale;
    onChange(value === 'en' || value === 'bn' ? value : null);
  });
}

export async function setPreferredLocale(uid: string, locale: Locale) {
  await setDoc(
    doc(db, 'users', uid),
    { preferredLocale: locale, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
