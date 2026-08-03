// apps/web/src/lib/hub/event.firestore.ts
//
// Ported from CivilOS Hub's lib/firestore/event.firestore.ts. Only the db
// import changed (Draw's own firebase-client.ts instead of Hub's
// firebase.ts) — both ultimately point at the same Firebase project via
// the same NEXT_PUBLIC_FIREBASE_* env vars, so this reads/writes the
// exact same projects/{projectId}/events collection Hub itself uses.
//
// This file intentionally doesn't import dependency.firestore.ts,
// approval.firestore.ts, or hub-write.ts — those import THIS file (to
// emit), not the other way around, matching Hub's own import direction
// to avoid a circular import.

import {
  doc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import type { HubEvent, HubEventType } from './event.types';
import type { SourceApp } from './contract.types';

function toISO(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return new Date().toISOString();
}

function toEvent(id: string, d: Record<string, unknown>): HubEvent {
  return {
    id,
    projectId: d.projectId as string,
    type: d.type as HubEventType,
    sourceApp: d.sourceApp as SourceApp,
    payload: d.payload as Record<string, unknown> | undefined,
    createdAt: toISO(d.createdAt),
  };
}

export async function emitEvent(
  projectId: string,
  type: HubEventType,
  sourceApp: SourceApp,
  payload?: Record<string, unknown>,
): Promise<void> {
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await setDoc(doc(db, 'projects', projectId, 'events', id), {
    projectId,
    type,
    sourceApp,
    ...(payload ? { payload } : {}),
    createdAt: serverTimestamp(),
  });
}

export async function getProjectEvents(projectId: string, max = 20): Promise<HubEvent[]> {
  const snaps = await getDocs(
    query(collection(db, 'projects', projectId, 'events'), orderBy('createdAt', 'desc'), limit(max)),
  );
  return snaps.docs.map((s) => toEvent(s.id, s.data()));
}

export function subscribeToEvents(
  projectId: string,
  onUpdate: (events: HubEvent[]) => void,
  max = 20,
): () => void {
  const q = query(collection(db, 'projects', projectId, 'events'), orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(
    q,
    (snap) => {
      onUpdate(snap.docs.map((s) => toEvent(s.id, s.data())));
    },
    () => {
      onUpdate([]); // permission/network error — show empty, don't crash
    },
  );
}
