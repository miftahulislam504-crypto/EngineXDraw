'use client';

import clsx from 'clsx';
import { useI18nStore, type Locale } from '@/lib/i18n';
import { useAuthStore } from '@/lib/auth-store';
import { setPreferredLocale } from '@/lib/user-profile';

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useI18nStore();
  const user = useAuthStore((s) => s.user);

  function handleSetLocale(next: Locale) {
    setLocale(next);
    if (user) {
      // Best-effort cross-device sync — localStorage already has the
      // choice for this browser, so a failed write here just means other
      // devices won't see the update until the next successful toggle.
      setPreferredLocale(user.uid, next).catch(() => {});
    }
  }

  return (
    <div className={clsx('inline-flex overflow-hidden rounded-sheet border border-line-strong', className)}>
      <button
        onClick={() => handleSetLocale('en')}
        className={clsx(
          'px-2 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors',
          locale === 'en' ? 'bg-ink text-white' : 'bg-surface text-ink-muted hover:text-ink',
        )}
      >
        EN
      </button>
      <button
        onClick={() => handleSetLocale('bn')}
        className={clsx(
          'px-2 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors',
          locale === 'bn' ? 'bg-ink text-white' : 'bg-surface text-ink-muted hover:text-ink',
        )}
      >
        বাংলা
      </button>
    </div>
  );
}
