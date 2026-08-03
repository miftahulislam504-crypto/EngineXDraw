// apps/web/src/lib/hub/dependency.firestore.ts
//
// Ported from CivilOS Hub's lib/firestore/dependency.firestore.ts — see
// the note at the top of event.firestore.ts.

import { doc, getDoc, setDoc, collection, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import {
  type ModuleId,
  type ModuleVersionRecord,
  type ModuleDependency,
  type DependencyStatus,
  getDependencyStatus,
} from './dependency.types';
import { downgradeToOutdatedIfApproved, getApprovalStatus } from './approval.firestore';
import { emitEvent } from './event.firestore';

function toISO(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return new Date().toISOString();
}

const versionRef = (projectId: string, moduleId: ModuleId) => doc(db, 'projects', projectId, 'versions', moduleId);

export async function bumpModuleVersion(projectId: string, moduleId: ModuleId): Promise<number> {
  const ref = versionRef(projectId, moduleId);
  const snap = await getDoc(ref);
  const nextVersion = snap.exists() ? (snap.data().currentVersion ?? 1) + 1 : 1;

  await setDoc(ref, {
    moduleId,
    currentVersion: nextVersion,
    updatedAt: serverTimestamp(),
  });

  try {
    await emitEvent(projectId, 'MODULE_VERSION_BUMPED', 'hub', { moduleId, newVersion: nextVersion });
  } catch {
    /* non-critical */
  }

  try {
    await downgradeToOutdatedIfApproved(
      projectId,
      moduleId,
      `${moduleId} সম্পাদনা করার ফলে v${nextVersion} এ পরিবর্তিত হয়েছে — পুনরায় review প্রয়োজন`,
    );

    const dependents = (await getProjectDependencies(projectId)).filter((d) => d.upstreamModule === moduleId);

    for (const dep of dependents) {
      const status = getDependencyStatus(dep, nextVersion);
      if (status === 'OUTDATED') {
        await downgradeToOutdatedIfApproved(
          projectId,
          dep.dependentModule,
          `উৎস "${moduleId}" এখন v${nextVersion} — এই module পুরনো v${dep.upstreamVersionAtLink} দেখে approve হয়েছিল`,
        );
      }
    }
  } catch {
    /* non-critical, approval cascade best-effort */
  }

  return nextVersion;
}

export async function getModuleVersion(projectId: string, moduleId: ModuleId): Promise<ModuleVersionRecord | null> {
  const snap = await getDoc(versionRef(projectId, moduleId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    moduleId,
    currentVersion: d.currentVersion ?? 1,
    updatedAt: toISO(d.updatedAt),
  };
}

export async function getAllModuleVersions(projectId: string): Promise<ModuleVersionRecord[]> {
  const snaps = await getDocs(collection(db, 'projects', projectId, 'versions'));
  return snaps.docs.map((s) => {
    const d = s.data();
    return {
      moduleId: s.id as ModuleId,
      currentVersion: d.currentVersion ?? 1,
      updatedAt: toISO(d.updatedAt),
    };
  });
}

const dependencyRef = (projectId: string, dependencyId: string) => doc(db, 'projects', projectId, 'dependencies', dependencyId);

export async function linkDependency(
  projectId: string,
  dependentModule: ModuleId,
  upstreamModule: ModuleId,
  upstreamVersionAtLink: number,
  reason: string,
): Promise<ModuleDependency> {
  const id = `${dependentModule}__depends_on__${upstreamModule}`;
  const ref = dependencyRef(projectId, id);

  const payload = {
    projectId,
    dependentModule,
    upstreamModule,
    upstreamVersionAtLink,
    reason,
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, payload);

  try {
    await emitEvent(projectId, 'MODULE_DEPENDENCY_LINKED', 'hub', {
      dependentModule,
      upstreamModule,
      upstreamVersionAtLink,
    });
  } catch {
    /* non-critical */
  }

  return {
    id,
    projectId,
    dependentModule,
    upstreamModule,
    upstreamVersionAtLink,
    reason,
    createdAt: new Date().toISOString(),
  };
}

export async function getProjectDependencies(projectId: string): Promise<ModuleDependency[]> {
  const snaps = await getDocs(collection(db, 'projects', projectId, 'dependencies'));
  return snaps.docs.map((s) => {
    const d = s.data();
    return {
      id: s.id,
      projectId,
      dependentModule: d.dependentModule,
      upstreamModule: d.upstreamModule,
      upstreamVersionAtLink: d.upstreamVersionAtLink ?? 1,
      reason: d.reason ?? '',
      createdAt: toISO(d.createdAt),
    };
  });
}

export interface DependencyWithStatus extends ModuleDependency {
  status: DependencyStatus;
  upstreamCurrentVersion: number;
}

export async function getProjectDependencyStatuses(projectId: string): Promise<DependencyWithStatus[]> {
  const [dependencies, versions] = await Promise.all([getProjectDependencies(projectId), getAllModuleVersions(projectId)]);

  const versionMap = new Map(versions.map((v) => [v.moduleId, v.currentVersion]));

  return dependencies.map((dep) => {
    const upstreamCurrentVersion = versionMap.get(dep.upstreamModule) ?? dep.upstreamVersionAtLink;
    return {
      ...dep,
      upstreamCurrentVersion,
      status: getDependencyStatus(dep, upstreamCurrentVersion),
    };
  });
}

export interface UnlockStatus {
  unlocked: boolean;
  blockedBy: ModuleId[];
}

export async function isModuleUnlocked(projectId: string, moduleId: ModuleId): Promise<UnlockStatus> {
  const upstreamDeps = (await getProjectDependencies(projectId)).filter((d) => d.dependentModule === moduleId);

  if (upstreamDeps.length === 0) return { unlocked: true, blockedBy: [] };

  const blockedBy: ModuleId[] = [];
  for (const dep of upstreamDeps) {
    const approval = await getApprovalStatus(projectId, dep.upstreamModule);
    if (!approval || approval.status !== 'APPROVED') {
      blockedBy.push(dep.upstreamModule);
    }
  }

  return { unlocked: blockedBy.length === 0, blockedBy };
}
