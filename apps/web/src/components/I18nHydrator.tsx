'use client';

import { useEffect } from 'react';
import { useI18nStore } from '@/lib/i18n';
import { useAuthStore } from '@/lib/auth-store';
import { subscribeToPreferredLocale } from '@/lib/user-profile';

export function I18nHydrator() {
  const hydrateFromStorage = useI18nStore((s) => s.hydrateFromStorage);
  const setLocale = useI18nStore((s) => s.setLocale);
  const user = useAuthStore((s) => s.user);

  // Local-first: apply the last locale saved on this browser immediately,
  // so there's no flash of the default language before Firebase Auth
  // resolves who's signed in.
  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  // Cross-device: once we know who's signed in, the Firestore-saved
  // preference (set from any device via the language toggle) is the more
  // authoritative source and wins over whatever's cached locally here.
  // If the field isn't set yet (older account, or never touched the
  // toggle), this is a no-op and the local preference stands.
  useEffect(() => {
    if (!user) return;
    return subscribeToPreferredLocale(user.uid, (remoteLocale) => {
      if (remoteLocale) setLocale(remoteLocale);
    });
  }, [user, setLocale]);

  return null;
}
