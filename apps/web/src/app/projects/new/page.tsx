'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, PageHeader } from '@archibim/shared-ui';
import type { NewProjectWizardInput } from '@archibim/object-model';
import { createProject } from '@/lib/projects';
import { useI18nStore } from '@/lib/i18n';

type BuildingDraft = { name: string; numberOfFloors: number; buildingType: string };

export default function NewProjectPage() {
  const router = useRouter();
  const { t } = useI18nStore();
  const STEPS = [t.wizard.stepBasics, t.wizard.stepSite, t.wizard.stepBuildings, t.wizard.stepReview];
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [landAreaSqm, setLandAreaSqm] = useState('');
  const [zoningType, setZoningType] = useState('');
  const [buildings, setBuildings] = useState<BuildingDraft[]>([
    { name: 'Main Building', numberOfFloors: 1, buildingType: 'Residential' },
  ]);

  function updateBuilding(index: number, patch: Partial<BuildingDraft>) {
    setBuildings((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  }

  function addBuilding() {
    setBuildings((prev) => [
      ...prev,
      { name: `Building ${prev.length + 1}`, numberOfFloors: 1, buildingType: '' },
    ]);
  }

  function removeBuilding(index: number) {
    setBuildings((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate() {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const input: NewProjectWizardInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        siteInfo: {
          address: address.trim() || undefined,
          landAreaSqm: landAreaSqm ? Number(landAreaSqm) : undefined,
          zoningType: zoningType.trim() || undefined,
        },
        buildings: buildings
          .filter((b) => b.name.trim())
          .map((b) => ({
            name: b.name.trim(),
            numberOfFloors: b.numberOfFloors,
            buildingType: b.buildingType || undefined,
          })),
      };
      const projectId = await createProject(input);
      router.replace(`/projects/${projectId}`);
    } catch (err) {
      setSubmitError(t.wizard.createErrorMessage);
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={t.wizard.eyebrow} title={STEPS[step]} />

      {/* Step indicator */}
      <div className="my-6 flex gap-2">
        {STEPS.map((label, i) => (
          <div
            key={label}
            className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-line'}`}
          />
        ))}
      </div>

      <div className="rounded-sheet border border-line bg-surface p-6 shadow-sheet">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <Input label={t.wizard.projectName} value={name} onChange={(e) => setName(e.target.value)} required />
            <Input
              label={t.wizard.descriptionOptional}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <Input label={t.wizard.siteAddress} value={address} onChange={(e) => setAddress(e.target.value)} />
            <Input
              label={t.wizard.landArea}
              type="number"
              value={landAreaSqm}
              onChange={(e) => setLandAreaSqm(e.target.value)}
            />
            <Input label={t.wizard.zoningType} value={zoningType} onChange={(e) => setZoningType(e.target.value)} />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            {buildings.map((b, i) => (
              <div key={i} className="rounded-sheet border border-line p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase text-ink-faint">
                    Building {i + 1}
                  </span>
                  {buildings.length > 1 && (
                    <button
                      onClick={() => removeBuilding(i)}
                      className="text-xs text-danger hover:underline"
                    >
                      {t.wizard.remove}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t.wizard.buildingName}
                    value={b.name}
                    onChange={(e) => updateBuilding(i, { name: e.target.value })}
                  />
                  <Input
                    label={t.wizard.floors}
                    type="number"
                    min={1}
                    value={b.numberOfFloors}
                    onChange={(e) => updateBuilding(i, { numberOfFloors: Number(e.target.value) })}
                  />
                  <Input
                    label={t.wizard.buildingType}
                    value={b.buildingType}
                    onChange={(e) => updateBuilding(i, { buildingType: e.target.value })}
                    className="col-span-2"
                  />
                </div>
              </div>
            ))}
            <Button variant="secondary" onClick={addBuilding}>
              {t.wizard.addAnotherBuilding}
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3 font-mono text-sm">
            <Row label={t.wizard.reviewName} value={name || '—'} />
            <Row label={t.wizard.reviewDescription} value={description || '—'} />
            <Row label={t.wizard.reviewAddress} value={address || '—'} />
            <Row label={t.wizard.reviewLandArea} value={landAreaSqm ? `${landAreaSqm} sqm` : '—'} />
            <Row label={t.wizard.reviewBuildings} value={String(buildings.length)} />
            {submitError && <p className="text-danger">{submitError}</p>}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          {t.common.back}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !name.trim()}>
            {t.common.next}
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? t.wizard.creatingProject : t.wizard.createProject}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line pb-2">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
