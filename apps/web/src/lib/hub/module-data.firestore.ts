// apps/web/src/lib/hub/module-data.firestore.ts
//
// Ported from CivilOS Hub's lib/firestore/module-data.firestore.ts —
// Hub's own design principle (see its file comment): "Large Geometry,
// Analysis Matrix, Mesh, Large Result Dataset... go to Firebase Storage.
// Firestore only holds metadata/status/reference/version/storagePath."
// EngineXDraw's own architectural model (walls, rooms, doors, stairs,
// roofs — everything hub-export.ts assembles) is exactly this kind of
// heavy structured data, so it follows the same pattern rather than
// writing it as Firestore document fields directly.

import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase-client';
import type { ModuleId } from './dependency.types';
import type { SourceApp } from './contract.types';
import { bumpModuleVersion } from './dependency.firestore';

export interface ModuleDataFile {
  fileName: string;
  fileUrl: string;
  storagePath: string;
  fileSize: number;
  fileType: string;
  uploadedAt: string;
  sourceApp: SourceApp;
  moduleVersion: number;
}

// Storage path: projects/{projectId}/moduleData/{moduleId}/{timestamp}_{filename}
export async function uploadModuleData(
  projectId: string,
  moduleId: ModuleId,
  sourceApp: SourceApp,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ModuleDataFile> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `projects/${projectId}/moduleData/${moduleId}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      () => resolve(),
    );
  });

  const fileUrl = await getDownloadURL(storageRef);
  const moduleVersion = await bumpModuleVersion(projectId, moduleId);

  const record: ModuleDataFile = {
    fileName: file.name,
    fileUrl,
    storagePath,
    fileSize: file.size,
    fileType: file.type || 'application/octet-stream',
    uploadedAt: new Date().toISOString(),
    sourceApp,
    moduleVersion,
  };

  await setDoc(doc(db, 'projects', projectId, 'moduleMetadata', moduleId), {
    ...record,
    updatedAt: serverTimestamp(),
  });

  return record;
}

export async function getModuleDataFile(projectId: string, moduleId: ModuleId): Promise<ModuleDataFile | null> {
  const snap = await getDoc(doc(db, 'projects', projectId, 'moduleMetadata', moduleId));
  if (!snap.exists()) return null;
  const d = snap.data();
  if (!d.storagePath) return null;
  return {
    fileName: d.fileName,
    fileUrl: d.fileUrl,
    storagePath: d.storagePath,
    fileSize: d.fileSize,
    fileType: d.fileType,
    uploadedAt: d.uploadedAt,
    sourceApp: d.sourceApp,
    moduleVersion: d.moduleVersion,
  } as ModuleDataFile;
}
