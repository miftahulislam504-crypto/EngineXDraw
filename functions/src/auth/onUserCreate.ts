import { auth as authTrigger } from 'firebase-functions/v1';
import { db } from '../common/admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Firebase Auth handles credentials; this mirrors the parts we need to
 * query/join on into Firestore as users/{uid}. Kept on the v1 SDK because
 * onCreate auth triggers are not yet available on 2nd-gen (v2) functions.
 */
export const onUserCreate = authTrigger.user().onCreate(async (user) => {
  await db
    .collection('users')
    .doc(user.uid)
    .set({
      id: user.uid,
      email: user.email ?? '',
      name: user.displayName ?? user.email?.split('@')[0] ?? 'New User',
      photoUrl: user.photoURL ?? null,
      twoFactorEnabled: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
});
