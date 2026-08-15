// apps/web/src/lib/hub/module-data-sync.firestore.ts
//
// Ported from CivilOS Hub's lib/firestore/module-data-sync.firestore.ts,
// following the same subset-port approach EngineXEstimate's
// hub-sdk-client.ts already used for this exact file (see that file's
// header comment — same reasoning applies here, not repeated).
//
// Two separate module-data mechanisms exist in this codebase and they
// must not be confused:
//   module-data.firestore.ts       -> HEAVY FILE reference (this app's
//                                      own geometry/BuildingElementRef
//                                      export). Storage file + Firestore
//                                      pointer. `moduleMetadata/{moduleId}`.
//                                      Unchanged by this file.
//   module-data-sync.firestore.ts  -> STRUCTURED FIELD data (schedules,
//                                      quantities — the Hub
//                                      ArchitecturalModuleData shape).
//                                      Plain Firestore document, JSON.
//                                      `moduleData/{moduleId}`.
//                                      <- this file
//
// Draw is the producer for 'architectural' here — saveOwnModuleData is
// therefore hardcoded to that moduleId, the same restriction Estimate's
// copy applies to itself (an app has no business overwriting another
// module's structured data).

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import type { ModuleId } from './dependency.types';
import type { SourceApp } from './contract.types';
import { emitEvent } from './event.firestore';

const OUR_APP = 'architectural' as const;

function toISO(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return new Date().toISOString();
}

export interface ModuleDataRecord<T = Record<string, unknown>> {
  moduleId: ModuleId;
  sourceApp: SourceApp;
  data: T;
  version: number;
  updatedAt: string;
}

const moduleDataRef = (projectId: string, moduleId: ModuleId) =>
  doc(db, 'projects', projectId, 'moduleData', moduleId);

const versionRef = (projectId: string, moduleId: ModuleId) =>
  doc(db, 'projects', projectId, 'versions', moduleId);

function toModuleDataRecord(moduleId: ModuleId, d: Record<string, unknown>): ModuleDataRecord {
  return {
    moduleId,
    sourceApp: d.sourceApp as SourceApp,
    data: (d.data as Record<string, unknown>) ?? {},
    version: (d.version as number) ?? 0,
    updatedAt: toISO(d.updatedAt),
  };
}

/** One-time read of any module's structured field data (e.g. Draw
 * reading nothing today, but this stays generic like Estimate's copy
 * in case a future increment needs to read an upstream module). */
export async function getModuleData(
  projectId: string,
  moduleId: ModuleId,
): Promise<ModuleDataRecord | null> {
  const snap = await getDoc(moduleDataRef(projectId, moduleId));
  if (!snap.exists()) return null;
  return toModuleDataRecord(moduleId, snap.data());
}

/** Real-time subscription to any module's structured field data. */
export function subscribeToModuleData(
  projectId: string,
  moduleId: ModuleId,
  onUpdate: (record: ModuleDataRecord | null) => void,
): Unsubscribe {
  return onSnapshot(
    moduleDataRef(projectId, moduleId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(toModuleDataRecord(moduleId, snap.data()));
    },
    () => onUpdate(null),
  );
}

/** Bumps this app's own module version in `versions/architectural` and
 * emits MODULE_VERSION_BUMPED — same mechanism hub-write.ts's
 * publishArchitecturalToHub already triggers directly via its own
 * bumpModuleVersion() call, exposed here separately because
 * saveOwnModuleData (structured fields) is a separate write path from
 * that function's saveModuleData() call. */
export async function bumpOwnModuleVersion(projectId: string): Promise<number> {
  const ref = versionRef(projectId, OUR_APP);
  const snap = await getDoc(ref);
  const nextVersion = snap.exists() ? ((snap.data().currentVersion as number) ?? 1) + 1 : 1;

  await setDoc(ref, { moduleId: OUR_APP, currentVersion: nextVersion, updatedAt: serverTimestamp() });

  try {
    await emitEvent(projectId, 'MODULE_VERSION_BUMPED', OUR_APP, { moduleId: OUR_APP, newVersion: nextVersion });
  } catch {
    /* non-critical */
  }

  return nextVersion;
}

/** Publishes Draw's structured field data (schedules/quantities — the
 * ArchitecturalModuleData shape) to Hub. merge:true so a partial push
 * (e.g. only roomSchedule changed) doesn't erase fields sent earlier.
 * Caller bumps the version first via bumpOwnModuleVersion() and passes
 * it in, so moduleData.version always matches versions/architectural
 * exactly — same convention as Estimate's saveOwnModuleData(). */
export async function saveOwnModuleData(
  projectId: string,
  data: Record<string, unknown>,
  version: number,
): Promise<void> {
  await setDoc(
    moduleDataRef(projectId, OUR_APP),
    { moduleId: OUR_APP, sourceApp: OUR_APP, data, version, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
