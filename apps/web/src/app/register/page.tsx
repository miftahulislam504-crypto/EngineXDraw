'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@archibim/shared-ui';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';

export default function RegisterPage() {
  const router = useRouter();
  const { register, errorKey, clearError } = useAuthStore();
  const { t } = useI18nStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await register(name, email, password);
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
          <div className="mb-2 flex items-center justify-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-sheet bg-ink font-display text-sm font-semibold text-white">
              E
            </span>
            <span className="font-display text-base font-medium tracking-tight text-ink">
              EngineX Draw
            </span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-medium text-ink">
            {t.auth.createAccount}
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-sheet border border-line bg-surface p-6 shadow-sheet"
        >
          <div className="flex flex-col gap-4">
            <Input
              label={t.auth.fullName}
              type="text"
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); clearError(); }}
            />
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
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError(); }}
            />
            {errorKey && <p className="text-sm text-danger">{t.auth[errorKey]}</p>}
            <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
              {isSubmitting ? t.auth.creatingAccount : t.auth.createAccount}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          {t.auth.alreadyHaveAccount}{' '}
          <Link href="/login" className="font-medium text-accent hover:text-accent-dark">
            {t.auth.signIn}
          </Link>
        </p>
      </div>
    </div>
  );
}
