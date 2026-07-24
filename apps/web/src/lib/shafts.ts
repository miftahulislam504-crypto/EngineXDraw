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
import type { Shaft } from '@archibim/object-model';

function shaftsCol(projectId: string, buildingId: string) {
  return collection(db, 'projects', projectId, 'buildings', buildingId, 'shafts');
}

export function subscribeToShafts(
  projectId: string,
  buildingId: string,
  onChange: (shafts: Shaft[]) => void,
) {
  return onSnapshot(shaftsCol(projectId, buildingId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shaft));
  });
}

export async function createShaft(
  projectId: string,
  buildingId: string,
  shaft: Omit<Shaft, 'id' | 'buildingId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(shaftsCol(projectId, buildingId), {
    ...shaft,
    buildingId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateShaft(
  projectId: string,
  buildingId: string,
  shaftId: string,
  patch: Partial<Pick<Shaft, 'shaftType' | 'startLevel' | 'endLevel' | 'label'>>,
) {
  await updateDoc(doc(shaftsCol(projectId, buildingId), shaftId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteShaft(projectId: string, buildingId: string, shaftId: string) {
  await deleteDoc(doc(shaftsCol(projectId, buildingId), shaftId));
}
