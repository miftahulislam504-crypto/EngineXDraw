'use client';

import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase-client';
import type { SiteInfo } from '@archibim/object-model';

/**
 * Patches Project.siteInfo with the Phase 5 fields (roadWidthM,
 * actualSetback*M) the Compliance page collects. Uses a direct
 * client-side updateDoc — no new Cloud Function needed, since the
 * project doc's Firestore rule already allows OWNER/ADMIN/EDITOR to
 * update it directly (the same rule projects.ts's other direct writes
 * rely on).
 */
export async function updateSiteInfo(projectId: string, patch: Partial<SiteInfo>) {
  await updateDoc(doc(db, 'projects', projectId), {
    ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`siteInfo.${k}`, v])),
  });
}
