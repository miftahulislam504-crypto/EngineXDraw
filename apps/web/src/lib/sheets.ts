'use client';

import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase-client';
import type { Sheet } from '@archibim/object-model';

function sheetsCol(projectId: string, buildingId: string) {
  return collection(db, 'projects', projectId, 'buildings', buildingId, 'sheets');
}

export function subscribeToSheets(
  projectId: string,
  buildingId: string,
  onChange: (sheets: Sheet[]) => void,
) {
  return onSnapshot(sheetsCol(projectId, buildingId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Sheet));
  });
}

export function subscribeToSheet(
  projectId: string,
  buildingId: string,
  sheetId: string,
  onChange: (sheet: Sheet | null) => void,
) {
  return onSnapshot(doc(sheetsCol(projectId, buildingId), sheetId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Sheet) : null);
  });
}

export async function createSheet(
  projectId: string,
  buildingId: string,
  sheet: Omit<Sheet, 'id' | 'buildingId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(sheetsCol(projectId, buildingId), {
    ...sheet,
    buildingId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSheet(
  projectId: string,
  buildingId: string,
  sheetId: string,
  patch: Partial<Pick<Sheet, 'name' | 'sheetNumber' | 'size' | 'scaleLabel' | 'drawnBy' | 'date'>>,
) {
  await updateDoc(doc(sheetsCol(projectId, buildingId), sheetId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSheet(projectId: string, buildingId: string, sheetId: string) {
  await deleteDoc(doc(sheetsCol(projectId, buildingId), sheetId));
}
