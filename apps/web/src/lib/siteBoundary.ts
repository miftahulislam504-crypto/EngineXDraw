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
import type { SiteBoundary } from '@archibim/object-model';

function siteBoundaryCol(projectId: string, buildingId: string) {
  return collection(db, 'projects', projectId, 'buildings', buildingId, 'siteBoundary');
}

/** In practice a building has at most one SiteBoundary — the UI enforces
 * this by deleting any existing one before creating a new one (see
 * design/page.tsx) — but this still subscribes to the collection rather
 * than a fixed doc id, consistent with every other building-level
 * entity here (Shaft, Sheet) being a real collection. */
export function subscribeToSiteBoundary(
  projectId: string,
  buildingId: string,
  onChange: (siteBoundary: SiteBoundary | null) => void,
) {
  return onSnapshot(siteBoundaryCol(projectId, buildingId), (snap) => {
    const first = snap.docs[0];
    onChange(first ? ({ id: first.id, ...first.data() } as SiteBoundary) : null);
  });
}

export async function createSiteBoundary(
  projectId: string,
  buildingId: string,
  siteBoundary: Omit<SiteBoundary, 'id' | 'buildingId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(siteBoundaryCol(projectId, buildingId), {
    ...siteBoundary,
    buildingId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSiteBoundary(
  projectId: string,
  buildingId: string,
  siteBoundaryId: string,
  patch: Partial<Pick<SiteBoundary, 'frontEdge' | 'boundary'>>,
) {
  await updateDoc(doc(siteBoundaryCol(projectId, buildingId), siteBoundaryId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSiteBoundary(projectId: string, buildingId: string, siteBoundaryId: string) {
  await deleteDoc(doc(siteBoundaryCol(projectId, buildingId), siteBoundaryId));
}
