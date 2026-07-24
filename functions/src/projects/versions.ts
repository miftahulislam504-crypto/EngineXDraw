import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../common/admin';
import { writeAuditLog } from '../common/audit';
import { roleAtLeast, type ProjectRole } from '@archibim/object-model';

export const createProjectVersion = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const { projectId, label, snapshot } = (request.data ?? {}) as {
    projectId?: string;
    label?: string;
    snapshot?: Record<string, unknown>;
  };
  if (!projectId || !label) {
    throw new HttpsError('invalid-argument', 'projectId and label are required.');
  }

  const memberDoc = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .doc(uid)
    .get();
  const role = memberDoc.data()?.role as ProjectRole | undefined;
  if (!role || !roleAtLeast(role, 'EDITOR')) {
    throw new HttpsError('permission-denied', 'EDITOR role or higher is required to save a version.');
  }

  const versionRef = db
    .collection('projects')
    .doc(projectId)
    .collection('versions')
    .doc();

  await versionRef.set({
    label,
    snapshot: snapshot ?? {},
    isLocked: false,
    createdById: uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection('projects').doc(projectId).update({
    lastSyncedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    userId: uid,
    action: 'VERSION_CREATED',
    entityType: 'version',
    entityId: versionRef.id,
    metadata: { projectId, label },
  });

  return { versionId: versionRef.id };
});

export const lockProjectVersion = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const { projectId, versionId, isLocked } = (request.data ?? {}) as {
    projectId?: string;
    versionId?: string;
    isLocked?: boolean;
  };
  if (!projectId || !versionId || typeof isLocked !== 'boolean') {
    throw new HttpsError('invalid-argument', 'projectId, versionId, and isLocked are required.');
  }

  const memberDoc = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .doc(uid)
    .get();
  const role = memberDoc.data()?.role as ProjectRole | undefined;
  if (!role || !roleAtLeast(role, 'ADMIN')) {
    throw new HttpsError('permission-denied', 'ADMIN role or higher is required to lock a version.');
  }

  await db
    .collection('projects')
    .doc(projectId)
    .collection('versions')
    .doc(versionId)
    .update({ isLocked });

  await writeAuditLog({
    userId: uid,
    action: 'VERSION_LOCKED',
    entityType: 'version',
    entityId: versionId,
    metadata: { projectId, isLocked },
  });

  return { success: true };
});
