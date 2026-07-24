import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../common/admin';
import { writeAuditLog } from '../common/audit';
import type { NewProjectWizardInput } from '@archibim/object-model';

export const createProject = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const uid = request.auth.uid;
  const input = request.data as NewProjectWizardInput;

  if (!input?.name?.trim()) {
    throw new HttpsError('invalid-argument', 'Project name is required.');
  }

  const projectRef = db.collection('projects').doc();
  const batch = db.batch();

  batch.set(projectRef, {
    name: input.name.trim(),
    description: input.description ?? null,
    status: 'ACTIVE',
    templateId: input.templateId ?? null,
    teamId: input.teamId ?? null,
    siteInfo: input.siteInfo ?? null,
    archivedAt: null,
    lastSyncedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  // Owner membership — this is what Firestore rules check for every
  // subsequent read/write against this project.
  const ownerRecord = await db.collection('users').doc(uid).get();
  const ownerData = ownerRecord.data();
  batch.set(projectRef.collection('members').doc(uid), {
    userId: uid,
    role: 'OWNER',
    displayName: ownerData?.name ?? 'Owner',
    email: ownerData?.email ?? '',
    joinedAt: FieldValue.serverTimestamp(),
  });

  // Multi-Building Support: seed buildings from the wizard, falling back to
  // a single default building so a project is never created with nowhere
  // for the Design Studio (Phase 2) to draw.
  const buildingsToCreate =
    input.buildings && input.buildings.length > 0
      ? input.buildings
      : [{ name: 'Main Building', numberOfFloors: 1 }];

  for (const building of buildingsToCreate) {
    const buildingRef = projectRef.collection('buildings').doc();
    batch.set(buildingRef, {
      name: building.name,
      numberOfFloors: building.numberOfFloors ?? 1,
      buildingType: building.buildingType ?? null,
      totalAreaSqm: building.totalAreaSqm ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Give every building a Ground Floor immediately so the Design Studio
    // (Phase 2) always has somewhere to draw without an extra setup step.
    const floorRef = buildingRef.collection('floors').doc();
    batch.set(floorRef, {
      buildingId: buildingRef.id,
      level: 0,
      name: 'Ground Floor',
      floorToFloorHeight: 3.05,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  await writeAuditLog({
    userId: uid,
    action: 'PROJECT_CREATED',
    entityType: 'project',
    entityId: projectRef.id,
    metadata: { name: input.name },
  });

  return { projectId: projectRef.id };
});
