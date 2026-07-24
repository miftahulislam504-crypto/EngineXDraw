'use client';

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Button, Input, PageHeader } from '@archibim/shared-ui';
import { functions } from '@/lib/firebase-client';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';

type EnrollmentState = 'idle' | 'awaiting-code' | 'enabled';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const { t } = useI18nStore();
  const [state, setState] = useState<EnrollmentState>('idle');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function startEnrollment() {
    setIsBusy(true);
    setError(null);
    try {
      const fn = httpsCallable<unknown, { qrCodeDataUrl: string }>(
        functions,
        'beginTwoFactorEnrollment',
      );
      const result = await fn();
      setQrCodeDataUrl(result.data.qrCodeDataUrl);
      setState('awaiting-code');
    } catch {
      setError(t.settings.startErrorMessage);
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmEnrollment() {
    setIsBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'confirmTwoFactorEnrollment');
      await fn({ code });
      setState('enabled');
    } catch {
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
