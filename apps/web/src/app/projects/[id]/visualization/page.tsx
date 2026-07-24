'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@archibim/shared-ui';
import type { Building, Floor, Project, SiteBoundary } from '@archibim/object-model';
import { subscribeToBuildings, subscribeToProject } from '@/lib/projects';
import { subscribeToFloorElements, subscribeToFloors, type FloorElements } from '@/lib/floors';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import { BuildingRenderStudioView } from '@/components/design/BuildingRenderStudioView';
import { ENVIRONMENT_PRESETS, MATERIAL_THEMES, findMaterialTheme, type EnvironmentPreset, type MaterialThemeId } from '@/lib/render-theme';

export default function VisualizationPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);

  const [materialThemeId, setMaterialThemeId] = useState<MaterialThemeId>(MATERIAL_THEMES[0].id);
  const [environmentPreset, setEnvironmentPreset] = useState<EnvironmentPreset>('city');
  const [qualityMode, setQualityMode] = useState<'draft' | 'high'>('high');
  const [autoRotate, setAutoRotate] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingUnsupported, setRecordingUnsupported] = useState(false);

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

  // Revoke the previous recording's object URL whenever a new one is made
  // (or the page unmounts) — otherwise each recording leaks the blob.
  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [recordingUrl]);

  const loadedFloorCount = floors.filter((f) => floorElements[f.id]).length;
  const hasAnyWalls = floors.some((f) => (floorElements[f.id]?.walls.length ?? 0) > 0);
  const materialTheme = useMemo(() => findMaterialTheme(materialThemeId), [materialThemeId]);

  function startRecording() {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      setRecordingUnsupported(true);
      return;
    }
    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      setRecordingUrl(URL.createObjectURL(blob));
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setAutoRotate(true); // a still, unmoving "walkthrough" isn't much of one
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  if (project === undefined) {
    return <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>;
  }
  if (project === null) {
    return <p className="text-sm text-danger">{t.projectDetail.notFound}</p>;
  }

  return (
    <div>
      <PageHeader eyebrow={project.name} title={t.visualization.pageTitle} />

      {buildings.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">{t.visualization.noBuildings}</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            {buildings.length > 1 && (
              <label className="mb-4 flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.visualization.buildingLabel}
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

            {!hasAnyWalls ? (
              <p className="font-mono text-sm text-ink-muted">{t.visualization.loadingData}</p>
            ) : (
              <>
                {loadedFloorCount < floors.length && (
                  <p className="mb-2 font-mono text-xs text-ink-faint">
                    {formatTemplate(t.common.loadingFloorsProgress, { loaded: loadedFloorCount, total: floors.length })}
                  </p>
                )}
                <BuildingRenderStudioView
                  floors={floors}
                  floorElements={floorElements}
                  siteBoundary={siteBoundary}
                  materialTheme={materialTheme}
                  environmentPreset={environmentPreset}
                  qualityMode={qualityMode}
                  autoRotate={autoRotate}
                  height={520}
                  onCanvasReady={(canvas) => {
                    canvasRef.current = canvas;
                  }}
                />
              </>
            )}

            <div className="mt-8 rounded-sheet border border-line bg-paper p-4">
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                {t.visualization.gapsTitle}
              </h2>
              <p className="text-sm text-ink-muted">{t.visualization.gapsBody}</p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.visualization.controlsTitle}
            </h2>
            <div className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.visualization.materialThemeLabel}
                </span>
                <select
                  value={materialThemeId}
                  onChange={(e) => setMaterialThemeId(e.target.value as MaterialThemeId)}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                >
                  {MATERIAL_THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {t.visualization.materialThemes[theme.labelKey]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.visualization.environmentLabel}
                </span>
                <select
                  value={environmentPreset}
                  onChange={(e) => setEnvironmentPreset(e.target.value as EnvironmentPreset)}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                >
                  {ENVIRONMENT_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {t.visualization.environmentPresets[preset]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.visualization.qualityLabel}
                </span>
                <select
                  value={qualityMode}
                  onChange={(e) => setQualityMode(e.target.value as 'draft' | 'high')}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                >
                  <option value="high">{t.visualization.qualityHigh}</option>
                  <option value="draft">{t.visualization.qualityDraft}</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
                {t.visualization.autoRotateLabel}
              </label>

              <div className="mt-2 border-t border-line pt-3">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.visualization.walkthroughVideoLabel}
                </span>
                {recordingUnsupported ? (
                  <p className="text-xs text-danger">{t.visualization.recordingUnsupported}</p>
                ) : (
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className="rounded-sheet border border-line-strong px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink hover:bg-paper"
                  >
                    {isRecording ? t.visualization.stopRecording : t.visualization.startRecording}
                  </button>
                )}
                {recordingUrl && !isRecording && (
                  <a
                    href={recordingUrl}
                    download="walkthrough.webm"
                    className="mt-2 block rounded-sheet border border-line-strong px-3 py-1.5 text-center font-mono text-xs uppercase tracking-wide text-ink hover:bg-paper"
                  >
                    {t.visualization.downloadRecording}
                  </a>
                )}
                <p className="mt-2 text-xs text-ink-faint">{t.visualization.walkthroughHint}</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
