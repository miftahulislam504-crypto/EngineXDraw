import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { db, auth } from '../common/admin';
import { writeAuditLog } from '../common/audit';

/**
 * Step 1: generate a TOTP secret + otpauth QR code. Stored under a
 * `pending2fa` field until confirmed, so a half-finished enrollment never
 * silently enables 2FA.
 */
export const beginTwoFactorEnrollment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const uid = request.auth.uid;
  const userRecord = await auth.getUser(uid);
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(
    userRecord.email ?? uid,
    'ArchiBIM Platform',
    secret,
  );
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  await db.collection('users').doc(uid).set(
    { pending2faSecret: secret },
    { merge: true },
  );

  return { qrCodeDataUrl, secret };
});

/**
 * Step 2: verify the 6-digit code from the user's authenticator app. Only
 * on success does twoFactorEnabled flip to true and the secret become
 * permanent — this is the point audited as a security-relevant action.
 */
export const confirmTwoFactorEnrollment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const uid = request.auth.uid;
  const code = request.data?.code as string | undefined;
  if (!code) {
    throw new HttpsError('invalid-argument', 'A 6-digit code is required.');
  }

  const userDoc = await db.collection('users').doc(uid).get();
  const pendingSecret = userDoc.data()?.pending2faSecret as string | undefined;
  if (!pendingSecret) {
    throw new HttpsError(
      'failed-precondition',
      'No pending 2FA enrollment found — call beginTwoFactorEnrollment first.',
    );
  }

  const isValid = authenticator.check(code, pendingSecret);
  if (!isValid) {
    throw new HttpsError('invalid-argument', 'Incorrect code — try again.');
  }

  await db.collection('users').doc(uid).set(
    {
      twoFactorEnabled: true,
      twoFactorSecret: pendingSecret,
      pending2faSecret: null,
    },
    { merge: true },
  );

  await writeAuditLog({
    userId: uid,
    action: 'MEMBER_ROLE_CHANGED', // closest existing action; consider adding a dedicated '2FA_ENABLED' action as the audit vocabulary grows
    entityType: 'member',
    entityId: uid,
    metadata: { event: '2FA_ENABLED' },
  });

  return { success: true };
});

/** Verify a code at login time for an account with 2FA already enabled. */
export const verifyTwoFactorCode = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const uid = request.auth.uid;
  const code = request.data?.code as string | undefined;
  if (!code) {
    throw new HttpsError('invalid-argument', 'A 6-digit code is required.');
  }

  const userDoc = await db.collection('users').doc(uid).get();
  const secret = userDoc.data()?.twoFactorSecret as string | undefined;
  if (!secret) {
    throw new HttpsError('failed-precondition', '2FA is not enabled for this account.');
  }

  const isValid = authenticator.check(code, secret);
  if (!isValid) {
    throw new HttpsError('invalid-argument', 'Incorrect code.');
  }

  return { success: true };
});
