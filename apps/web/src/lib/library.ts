'use client';

import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase-client';
import type { LibraryCategory, LibraryItem } from '@archibim/object-model';

function libraryCol() {
  return collection(db, 'libraryItems');
}

export function subscribeToLibrary(
  category: LibraryCategory | null,
  onChange: (items: LibraryItem[]) => void,
) {
  const q = category ? query(libraryCol(), where('category', '==', category)) : query(libraryCol());
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LibraryItem));
  });
}

export async function getLibraryOnce(category: LibraryCategory): Promise<LibraryItem[]> {
  const snap = await getDocs(query(libraryCol(), where('category', '==', category)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LibraryItem);
}

export async function createCustomLibraryItem(
  item: Omit<LibraryItem, 'id' | 'isCustom' | 'createdAt' | 'category'> & { category: LibraryCategory },
  createdBy: string,
) {
  await addDoc(libraryCol(), {
    ...item,
    isCustom: true,
    createdBy,
    createdAt: serverTimestamp(),
  });
}

/** Idempotent — calls the seedLibraryDefaults Cloud Function, which only
 * inserts items that don't already exist by (category, name). Safe to call
 * every time the Library Browser opens. */
export async function ensureLibrarySeeded() {
  const fn = httpsCallable(functions, 'seedLibraryDefaults');
  await fn();
}
