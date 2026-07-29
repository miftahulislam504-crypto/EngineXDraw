'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Input, PageHeader, SeverityBadge } from '@archibim/shared-ui';
import type {
  Building,
  ComplianceCategory,
  ComplianceIssue,
  Floor,
  Opening,
  Project,
  Ramp,
  SiteBoundary,
  SiteInfo,
} from '@archibim/object-model';
import {
  checkAccessibility,
  checkEscapeRoute,
  checkFar,
  checkFireSeparation,
  checkGroundCoverage,
  checkParking,
  checkSetback,
  computeGeometricSetback,
  detectBuildingFootprint,
} from '@archibim/core-engine';
import { subscribeToBuildings, subscribeToProject } from '@/lib/projects';
import { EMPTY_FLOOR_ELEMENTS, subscribeToFloorElements, subscribeToFloors, type FloorElements } from '@/lib/floors';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { updateSiteInfo } from '@/lib/compliance';
import { useI18nStore, formatTemplate } from '@/lib/i18n';

const CATEGORY_ORDER: ComplianceCategory[] = [
  'FAR',
  'GROUND_COVERAGE',
  'SETBACK',
  'PARKING',
  'FIRE_SAFETY',
  'ACCESSIBILITY',
  'ESCAPE_ROUTE',
];

export default function CompliancePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);

  const [roadWidthInput, setRoadWidthInput] = useState('');
  const [frontInput, setFrontInput] = useState('');
  const [rearInput, setRearInput] = useState('');
  const [sideInput, setSideInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const unsub1 = subscribeToProject(projectId, setProject);
    const unsub2 = subscribeToBuildings(projectId, setBuildings);
    return () => {
      unsub1();
      unsub2();
    };
  }, [projectId]);

  useEffect(() => {
    if (buildings.length > 0 && !buildingId) setBuildingId(buildings[0].id);
  }, [buildings, buildingId]);

  useEffect(() => {
    if (!buildingId) {
      setFloors([]);
      return;
    }
    return subscribeToFloors(projectId, buildingId, setFloors);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (floors.length === 0) {
      setFloorElements({});
      return;
    }
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [projectId, buildingId, floors]);

  useEffect(() => {
    if (!buildingId) {
      setSiteBoundary(null);
      return;
    }
    return subscribeToSiteBoundary(projectId, buildingId, setSiteBoundary);
  }, [projectId, buildingId]);

  // Seed the editable Site Info inputs once per project load — deliberately
  // not re-run on every snapshot (only project?.id, not project, is a dep)
  // so it doesn't stomp on text the user is mid-typing after their own save
  // round-trips back through onSnapshot.
  useEffect(() => {
    if (project?.siteInfo) {
      const s = project.siteInfo;
      setRoadWidthInput(s.roadWidthM !== undefined ? String(s.roadWidthM) : '');
      setFrontInput(s.actualSetbackFrontM !== undefined ? String(s.actualSetbackFrontM) : '');
      setRearInput(s.actualSetbackRearM !== undefined ? String(s.actualSetbackRearM) : '');
      setSideInput(s.actualSetbackSideM !== undefined ? String(s.actualSetbackSideM) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const currentBuilding = buildings.find((b) => b.id === buildingId);
  const allFloorsLoaded = floors.length > 0 && floors.every((f) => floorElements[f.id]);

  const issues = useMemo<ComplianceIssue[]>(() => {
    if (!currentBuilding || !allFloorsLoaded) return [];

    let totalGfaSqm = 0;
    let groundFootprintSqm = 0;
    let groundFootprintBoundary: { x: number; y: number }[] | null = null;
    let providedParkingSpaces = 0;
    const allOpenings: Opening[] = [];
    const allRamps: Ramp[] = [];
    const fireIssuesAllFloors: ComplianceIssue[] = [];
    const escapeRouteAllFloors: ComplianceIssue[] = [];

    for (const floor of floors) {
      const elements = floorElements[floor.id] ?? EMPTY_FLOOR_ELEMENTS;
      const footprint = detectBuildingFootprint(elements.walls);
      const footprintArea = footprint?.areaSqm ?? 0;
      totalGfaSqm += footprintArea;
      if (floor.level === 0) {
        groundFootprintSqm = footprintArea;
        groundFootprintBoundary = footprint?.boundary ?? null;
      }
      providedParkingSpaces += elements.placedObjects.filter((o) => o.category === 'PARKING').length;
      allOpenings.push(...elements.openings);
      allRamps.push(...elements.ramps);
      fireIssuesAllFloors.push(...checkFireSeparation(elements.walls, elements.rooms));
      escapeRouteAllFloors.push(
        ...checkEscapeRoute(elements.walls, elements.openings, elements.stairs, elements.rooms).map((issue) => ({
          ...issue,
          id: `${issue.id}:${floor.id}`,
        })),
      );
    }

    const result: ComplianceIssue[] = [];
    const landAreaSqm = project?.siteInfo?.landAreaSqm;
    const roadWidthM = project?.siteInfo?.roadWidthM ?? 6.0;

    if (!landAreaSqm) {
      result.push({ id: 'FAR:NO_SITE_AREA:building', category: 'FAR', severity: 'info', check: 'NO_SITE_AREA', values: {} });
    } else {
      result.push(...checkFar(totalGfaSqm, landAreaSqm, roadWidthM));
      result.push(...checkGroundCoverage(groundFootprintSqm, landAreaSqm, roadWidthM));

      // Geometric setback (real SiteBoundary drawn) takes priority over the
      // Pass 1 manual-entry fallback — see SiteBoundary's own doc comment
      // for why a drawn boundary is the more trustworthy source.
      const geometric =
        siteBoundary && groundFootprintBoundary
          ? computeGeometricSetback(groundFootprintBoundary, siteBoundary.boundary, siteBoundary.frontEdge)
          : null;
      result.push(
        ...checkSetback(landAreaSqm, currentBuilding.numberOfFloors, {
          frontM: geometric?.frontM ?? project?.siteInfo?.actualSetbackFrontM,
          rearM: geometric?.rearM ?? project?.siteInfo?.actualSetbackRearM,
          sideM: geometric?.sideM ?? project?.siteInfo?.actualSetbackSideM,
        }),
      );
    }

    result.push(...checkParking(providedParkingSpaces, totalGfaSqm, currentBuilding.buildingType));

    const fireProblems = fireIssuesAllFloors.filter((i) => i.check !== 'FIRE_RATING_OK');
    if (fireProblems.length > 0) {
      result.push(...fireProblems);
    } else {
      result.push({ id: 'FIRE_SAFETY:FIRE_RATING_OK:building', category: 'FIRE_SAFETY', severity: 'info', check: 'FIRE_RATING_OK', values: {} });
    }

    result.push(...checkAccessibility(allOpenings, allRamps));

    const escapeRouteProblems = escapeRouteAllFloors.filter((i) => i.check !== 'ESCAPE_ROUTE_OK');
    if (escapeRouteProblems.length > 0) {
      result.push(...escapeRouteProblems);
    } else if (escapeRouteAllFloors.length > 0) {
      result.push({ id: 'ESCAPE_ROUTE:ESCAPE_ROUTE_OK:building', category: 'ESCAPE_ROUTE', severity: 'info', check: 'ESCAPE_ROUTE_OK', values: {} });
    }

    return result;
  }, [currentBuilding, allFloorsLoaded, floors, floorElements, project, siteBoundary]);

  async function handleSaveSiteInfo() {
    setIsSaving(true);
    try {
      const patch: Partial<SiteInfo> = {};
      if (roadWidthInput.trim() !== '') patch.roadWidthM = parseFloat(roadWidthInput);
      if (frontInput.trim() !== '') patch.actualSetbackFrontM = parseFloat(frontInput);
      if (rearInput.trim() !== '') patch.actualSetbackRearM = parseFloat(rearInput);
      if (sideInput.trim() !== '') patch.actualSetbackSideM = parseFloat(sideInput);
      await updateSiteInfo(projectId, patch);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } finally {
      setIsSaving(false);
    }
  }

  if (project === undefined) {
    return <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>;
  }
  if (project === null) {
    return <p className="text-sm text-danger">{t.projectDetail.notFound}</p>;
  }

  const issuesByCategory = new Map<ComplianceCategory, ComplianceIssue[]>();
  for (const issue of issues) {
    const list = issuesByCategory.get(issue.category) ?? [];
    list.push(issue);
    issuesByCategory.set(issue.category, list);
  }

  const severityLabel: Record<ComplianceIssue['severity'], string> = {
    error: t.compliance.severityError,
    warning: t.compliance.severityWarning,
    info: t.compliance.severityInfo,
  };

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader eyebrow={project.projectName} title={t.compliance.pageTitle} />

      {buildings.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">{t.compliance.noBuildings}</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            {buildings.length > 1 && (
              <label className="mb-4 flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.compliance.buildingLabel}
                </span>
                <select
                  value={buildingId}
                  onChange={(e) => setBuildingId(e.target.value)}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                >
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!allFloorsLoaded ? (
              <p className="font-mono text-sm text-ink-muted">{t.compliance.loadingData}</p>
            ) : (
              <div className="flex flex-col gap-6">
                {CATEGORY_ORDER.map((category) => {
                  const categoryIssues = issuesByCategory.get(category);
                  if (!categoryIssues || categoryIssues.length === 0) return null;
                  return (
                    <div key={category}>
                      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                        {t.compliance.categories[category]}
                      </h2>
                      <div className="flex flex-col gap-2">
                        {categoryIssues.map((issue) => (
                          <div
                            key={issue.id}
                            className="flex items-start justify-between gap-3 rounded-sheet border border-line bg-surface px-4 py-3 text-sm"
                          >
                            <span className="text-ink">
                              {formatTemplate(t.compliance.messages[issue.check], issue.values)}
                            </span>
                            <SeverityBadge severity={issue.severity} label={severityLabel[issue.severity]} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-8 rounded-sheet border border-line bg-paper p-4">
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                {t.compliance.gapsTitle}
              </h2>
              <p className="text-sm text-ink-muted">{t.compliance.gapsBody}</p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.compliance.siteInfoTitle}
            </h2>
            <div className="flex flex-col gap-3 rounded-sheet border border-line bg-surface p-4">
              <Input
                label={t.compliance.roadWidthLabel}
                type="number"
                step="0.1"
                min="0"
                value={roadWidthInput}
                onChange={(e) => setRoadWidthInput(e.target.value)}
                placeholder="6.0"
              />
              <p className="text-xs text-ink-faint">{t.compliance.roadWidthHint}</p>

              <div className="mt-2 border-t border-line pt-3">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.compliance.setbackInputsTitle}
                </span>
                <p className="mt-1 text-xs text-ink-faint">
                  {siteBoundary ? t.compliance.setbackSourceGeometric : t.compliance.setbackSourceManual}
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input
                    label={t.compliance.actualFrontLabel}
                    type="number"
                    step="0.1"
                    min="0"
                    value={frontInput}
                    onChange={(e) => setFrontInput(e.target.value)}
                  />
                  <Input
                    label={t.compliance.actualRearLabel}
                    type="number"
                    step="0.1"
                    min="0"
                    value={rearInput}
                    onChange={(e) => setRearInput(e.target.value)}
                  />
                  <Input
                    label={t.compliance.actualSideLabel}
                    type="number"
                    step="0.1"
                    min="0"
                    value={sideInput}
                    onChange={(e) => setSideInput(e.target.value)}
                  />
                </div>
              </div>

              <Button onClick={handleSaveSiteInfo} disabled={isSaving} className="mt-2">
                {justSaved ? t.compliance.saved : t.compliance.save}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
