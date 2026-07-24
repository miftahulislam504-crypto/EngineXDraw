import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../common/admin';
import { writeAuditLog } from '../common/audit';
import { roleAtLeast, type ProjectRole } from '@archibim/object-model';

async function requireRole(projectId: string, uid: string, minimum: ProjectRole) {
  const memberDoc = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .doc(uid)
    .get();

  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'You are not a member of this project.');
  }
  const role = memberDoc.data()?.role as ProjectRole;
  if (!roleAtLeast(role, minimum)) {
    throw new HttpsError(
      'permission-denied',
      `This action requires ${minimum} or higher — you have ${role}.`,
    );
  }
}

export const archiveProject = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const projectId = request.data?.projectId as string | undefined;
  if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required.');

  await requireRole(projectId, uid, 'ADMIN');

  await db.collection('projects').doc(projectId).update({
    status: 'ARCHIVED',
    archivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    userId: uid,
    action: 'PROJECT_ARCHIVED',
    entityType: 'project',
    entityId: projectId,
  });

  return { success: true };
});

export const restoreProject = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const projectId = request.data?.projectId as string | undefined;
  if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required.');

  await requireRole(projectId, uid, 'ADMIN');

  await db.collection('projects').doc(projectId).update({
    status: 'ACTIVE',
    archivedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    userId: uid,
    action: 'PROJECT_RESTORED',
    entityType: 'project',
    entityId: projectId,
  });

  return { success: true };
});

export const updateMemberRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const { projectId, targetUserId, role } = (request.data ?? {}) as {
    projectId?: string;
    targetUserId?: string;
    role?: ProjectRole;
  };
  if (!projectId || !targetUserId || !role) {
    throw new HttpsError('invalid-argument', 'projectId, targetUserId, and role are required.');
  }

  // Only OWNER/ADMIN can change roles, and only OWNER can grant OWNER.
  await requireRole(projectId, uid, role === 'OWNER' ? 'OWNER' : 'ADMIN');

  await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .doc(targetUserId)
    .set({ role }, { merge: true });

  await writeAuditLog({
    userId: uid,
    action: 'MEMBER_ROLE_CHANGED',
    entityType: 'member',
    entityId: targetUserId,
    metadata: { projectId, newRole: role },
  });

  return { success: true };
});
