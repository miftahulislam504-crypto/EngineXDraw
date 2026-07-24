'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@archibim/shared-ui';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, errorKey, clearError } = useAuthStore();
  const { t } = useI18nStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await signIn(email, password);
      router.replace('/dashboard');
    } catch {
      // error state already set by the store
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <LanguageToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
            ArchiBIM Platform
          </div>
          <h1 className="mt-1 font-display text-2xl font-medium text-ink">
            {t.auth.signIn}
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-sheet border border-line bg-surface p-6 shadow-sheet"
        >
          <div className="flex flex-col gap-4">
            <Input
              label={t.auth.email}
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError(); }}
            />
            <Input
              label={t.auth.password}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError(); }}
            />
            {errorKey && <p className="text-sm text-danger">{t.auth[errorKey]}</p>}
            <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
              {isSubmitting ? t.auth.signingIn : t.auth.signIn}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          {t.auth.noAccountYet}{' '}
          <Link href="/register" className="font-medium text-accent hover:text-accent-dark">
            {t.auth.createOne}
          </Link>
        </p>
      </div>
    </div>
  );
}
