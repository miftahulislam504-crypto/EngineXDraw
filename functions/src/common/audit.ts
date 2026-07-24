import { db } from './admin';
import type { AuditAction } from '@archibim/object-model';
import { FieldValue } from 'firebase-admin/firestore';

export async function writeAuditLog(entry: {
  userId: string | null;
  action: AuditAction;
  entityType: 'project' | 'member' | 'version' | 'building';
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.collection('auditLogs').add({
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
}
