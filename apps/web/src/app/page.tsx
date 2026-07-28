'use client';

import Link from 'next/link';
import { Button } from '@archibim/shared-ui';
import { useI18nStore } from '@/lib/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';

const MODULES: { titleKey: string; bodyKey: string }[] = [
  { titleKey: 'moduleDesignTitle', bodyKey: 'moduleDesignBody' },
  { titleKey: 'moduleSheetsTitle', bodyKey: 'moduleSheetsBody' },
  { titleKey: 'moduleComplianceTitle', bodyKey: 'moduleComplianceBody' },
  { titleKey: 'moduleEnvironmentalTitle', bodyKey: 'moduleEnvironmentalBody' },
  { titleKey: 'moduleVisualizationTitle', bodyKey: 'moduleVisualizationBody' },
  { titleKey: 'moduleAutomationTitle', bodyKey: 'moduleAutomationBody' },
  { titleKey: 'moduleAnalyticsTitle', bodyKey: 'moduleAnalyticsBody' },
];

const WORKFLOW = [
  { titleKey: 'workflowStep1Title', bodyKey: 'workflowStep1Body' },
  { titleKey: 'workflowStep2Title', bodyKey: 'workflowStep2Body' },
  { titleKey: 'workflowStep3Title', bodyKey: 'workflowStep3Body' },
] as const;

export default function LandingPage() {
  const { t } = useI18nStore();
  const landing = t.landing as unknown as Record<string, string>;

  return (
    <div className="min-h-screen bg-paper">
      {/* Top bar */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
            {t.landing.brandEyebrow}
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Link href="/login" className="font-mono text-[11px] uppercase tracking-wide text-ink-muted hover:text-ink">
              {t.landing.signInLink}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="mx-auto max-w-3xl font-display text-4xl font-medium leading-tight text-ink sm:text-5xl">
          {t.landing.heroTitle}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-muted">
          {t.landing.heroSubtitle}
        </p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <Link href="/login">
            <Button size="md" className="px-8 py-3 text-base">
              {t.landing.getStarted}
            </Button>
          </Link>
          <p className="text-sm text-ink-faint">
            {t.landing.alreadyHaveAccount}{' '}
            <Link href="/login" className="font-medium text-accent hover:text-accent-dark">
              {t.landing.signInLink}
            </Link>
          </p>
        </div>
      </section>

      {/* Modules */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
              {t.landing.sectionModulesEyebrow}
            </div>
            <h2 className="mt-1 font-display text-2xl font-medium text-ink">
              {t.landing.sectionModulesTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((mod, index) => (
              <div
                key={mod.titleKey}
                className="rounded-sheet border border-line bg-paper p-5 shadow-sheet"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="font-display text-lg font-medium text-ink">
                  {landing[mod.titleKey]}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {landing[mod.bodyKey]}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
              {t.landing.sectionWorkflowEyebrow}
            </div>
            <h2 className="mt-1 font-display text-2xl font-medium text-ink">
              {t.landing.sectionWorkflowTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {WORKFLOW.map((step, index) => (
              <div key={step.titleKey} className="text-center sm:text-left">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-sheet bg-ink font-mono text-sm text-white sm:mx-0">
                  {index + 1}
                </div>
                <h3 className="font-display text-base font-medium text-ink">
                  {landing[step.titleKey]}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {landing[step.bodyKey]}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-16 text-center">
          <Link href="/login">
            <Button size="md" className="px-8 py-3 text-base">
              {t.landing.footerCta}
            </Button>
          </Link>
          <p className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {t.landing.footerTagline}
          </p>
        </div>
      </section>
    </div>
  );
}
