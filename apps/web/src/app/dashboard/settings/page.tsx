'use client';

import { useState } from 'react';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Button, Input, PageHeader } from '@archibim/shared-ui';
import { db } from '@/lib/firebase-client';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';

type EnrollmentState = 'idle' | 'awaiting-code' | 'enabled';

/**
 * 2FA enrollment used to run as two Cloud Functions (beginTwoFactorEnrollment /
 * confirmTwoFactorEnrollment), but the Firebase project is on the Spark
 * (free) plan, which cannot run Cloud Functions. Both otplib and qrcode
 * work fine in the browser, so this generates and verifies the TOTP
 * secret client-side and writes straight to the user's own `users/{uid}`
 * doc — same pattern as the rest of the app now.
 */
export default function SettingsPage() {
  const { user } = useAuthStore();
  const { t } = useI18nStore();
  const [state, setState] = useState<EnrollmentState>('idle');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function startEnrollment() {
    if (!user) return;
    setIsBusy(true);
    setError(null);
    try {
      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(
        user.email ?? user.uid,
        'ArchiBIM Platform',
        secret,
      );
      const dataUrl = await QRCode.toDataURL(otpauthUrl);

      // Stored under pending2faSecret until confirmed, so a
      // half-finished enrollment never silently enables 2FA.
      await setDoc(doc(db, 'users', user.uid), { pending2faSecret: secret }, { merge: true });

      setPendingSecret(secret);
      setQrCodeDataUrl(dataUrl);
      setState('awaiting-code');
    } catch (err) {
      console.error('startEnrollment failed:', err);
      setError(t.settings.startErrorMessage);
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmEnrollment() {
    if (!user) return;
    setIsBusy(true);
    setError(null);
    try {
      // Re-read the pending secret from Firestore rather than trusting
      // only local state, in case the user reloaded mid-enrollment.
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const secret = (userSnap.data()?.pending2faSecret as string | undefined) ?? pendingSecret;
      if (!secret) {
        setError(t.settings.incorrectCodeMessage);
        return;
      }

      const isValid = authenticator.check(code, secret);
      if (!isValid) {
        setError(t.settings.incorrectCodeMessage);
        return;
      }

      await setDoc(
        doc(db, 'users', user.uid),
        { twoFactorEnabled: true, twoFactorSecret: secret, pending2faSecret: null },
        { merge: true },
      );
      setState('enabled');
    } catch (err) {
      console.error('confirmEnrollment failed:', err);
      setError(t.settings.incorrectCodeMessage);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow={t.settings.eyebrow} title={t.settings.title} />

      <div className="mt-6 rounded-sheet border border-line bg-surface p-6">
        <h2 className="font-display text-lg font-medium text-ink">{t.settings.profileTitle}</h2>
        <p className="mt-1 text-sm text-ink-muted">{user?.email}</p>
      </div>

      <div className="mt-4 rounded-sheet border border-line bg-surface p-6">
        <h2 className="font-display text-lg font-medium text-ink">{t.settings.languageTitle}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t.settings.languageDescription}</p>
        <LanguageToggle className="mt-4" />
      </div>

      <div className="mt-4 rounded-sheet border border-line bg-surface p-6">
        <h2 className="font-display text-lg font-medium text-ink">
          {t.settings.twoFactorTitle}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{t.settings.twoFactorDescription}</p>

        {state === 'idle' && (
          <Button className="mt-4" onClick={startEnrollment} disabled={isBusy}>
            {isBusy ? t.settings.starting : t.settings.enable2FA}
          </Button>
        )}

        {state === 'awaiting-code' && qrCodeDataUrl && (
          <div className="mt-4 flex flex-col items-start gap-4">
            <p className="text-sm text-ink-muted">{t.settings.scanQrInstruction}</p>
            {/* Data-URL image from our own Cloud Function — not an external/remote src,
                so next/image's remote-pattern allowlist doesn't apply here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCodeDataUrl} alt="2FA QR code" width={200} height={200} />
            <div className="flex w-full max-w-xs items-end gap-2">
              <Input
                label={t.settings.sixDigitCode}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
              <Button onClick={confirmEnrollment} disabled={isBusy || code.length !== 6}>
                {t.settings.verify}
              </Button>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}

        {state === 'enabled' && (
          <p className="mt-4 text-sm text-success">{t.settings.twoFactorEnabledMessage}</p>
        )}
      </div>
    </div>
  );
}
