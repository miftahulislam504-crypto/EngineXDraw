'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { Button, PageHeader } from '@archibim/shared-ui';
import type {
  Balcony,
  Beam,
  Building,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
  Floor,
  Footing,
  Foundation,
  GridLine,
  Note,
  LibraryItem,
  Opening,
  PlacedObject,
  PlacedObjectCategory,
  Railing,
  Ramp,
  Roof,
  Room,
  SectionLine,
  Shaft,
  SiteBoundary,
  Skylight,
  Slab,
  Stair,
  Wall,
} from '@archibim/object-model';
import {
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  DEFAULT_DOOR_WIDTH,
  DEFAULT_DOOR_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_SILL_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_COLUMN_DEPTH,
  DEFAULT_COLUMN_HEIGHT,
  DEFAULT_BEAM_WIDTH,
  DEFAULT_BEAM_DEPTH,
  DEFAULT_SLAB_THICKNESS,
  DEFAULT_CEILING_THICKNESS,
  DEFAULT_FOUNDATION_THICKNESS,
  DEFAULT_FOOTING_WIDTH,
  DEFAULT_FOOTING_DEPTH,
  DEFAULT_FOOTING_THICKNESS,
  DEFAULT_ROOF_THICKNESS,
  DEFAULT_RAMP_WIDTH,
  DEFAULT_RAMP_THICKNESS,
  DEFAULT_RAMP_RISE,
  DEFAULT_RAILING_HEIGHT,
  DEFAULT_RAILING_POST_SPACING,
  DEFAULT_STAIR_WIDTH,
  DEFAULT_STAIR_RISER_HEIGHT,
  DEFAULT_STAIR_STEPS,
  DEFAULT_BALCONY_THICKNESS,
  DEFAULT_CURTAIN_WALL_HEIGHT,
  DEFAULT_CURTAIN_WALL_THICKNESS,
  DEFAULT_MULLION_SPACING,
  DEFAULT_SKYLIGHT_WIDTH,
  DEFAULT_SKYLIGHT_DEPTH,
  PLACED_OBJECT_DEFAULTS,
} from '@archibim/object-model';
import { joinCoincidentEndpoints } from '@archibim/core-engine';
import { subscribeToBuildings } from '@/lib/projects';
import { useAuthStore } from '@/lib/auth-store';
import {
  subscribeToFloors,
  subscribeToWalls,
  subscribeToOpenings,
  subscribeToColumns,
  subscribeToBeams,
  subscribeToSlabs,
  createWall,
  createOpening,
  createColumn,
  createBeam,
  createSlab,
  updateWall,
  updateWallsBatch,
  updateOpening,
  updateColumn,
  updateBeam,
  updateSlab,
  deleteWall,
  deleteOpening,
  deleteColumn,
  deleteBeam,
  deleteSlab,
  ceilingCrud,
  foundationCrud,
  footingCrud,
  roofCrud,
  rampCrud,
  railingCrud,
  stairCrud,
  balconyCrud,
  curtainWallCrud,
  skylightCrud,
  placedObjectCrud,
  dimensionCrud,
  noteCrud,
  gridLineCrud,
  sectionLineCrud,
} from '@/lib/floors';
import { subscribeToShafts, createShaft, updateShaft, deleteShaft } from '@/lib/shafts';
import {
  subscribeToSiteBoundary,
  createSiteBoundary,
  updateSiteBoundary,
  deleteSiteBoundary,
} from '@/lib/siteBoundary';
import { subscribeToRooms, reconcileRooms, updateRoom } from '@/lib/rooms';
import { useDesignStudioStore } from '@/lib/design-studio-store';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import { Toolbar } from '@/components/design/Toolbar';
import { FloorPlanCanvas } from '@/components/design/FloorPlanCanvas';
import { Live3DView } from '@/components/design/Live3DView';
import { PropertiesPanel } from '@/components/design/PropertiesPanel';
import { RoomListPanel } from '@/components/design/RoomListPanel';
import { LibraryBrowser } from '@/components/design/LibraryBrowser';

export default function DesignStudioPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const { user } = useAuthStore();

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [hasLoadedBuildings, setHasLoadedBuildings] = useState(false);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [beams, setBeams] = useState<Beam[]>([]);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [ceilings, setCeilings] = useState<Ceiling[]>([]);
  const [foundations, setFoundations] = useState<Foundation[]>([]);
  const [footings, setFootings] = useState<Footing[]>([]);
  const [roofs, setRoofs] = useState<Roof[]>([]);
  const [ramps, setRamps] = useState<Ramp[]>([]);
  const [railings, setRailings] = useState<Railing[]>([]);
  const [stairs, setStairs] = useState<Stair[]>([]);
  const [balconies, setBalconies] = useState<Balcony[]>([]);
  const [curtainWalls, setCurtainWalls] = useState<CurtainWall[]>([]);
  const [skylights, setSkylights] = useState<Skylight[]>([]);
  const [placedObjects, setPlacedObjects] = useState<PlacedObject[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [gridLines, setGridLines] = useState<GridLine[]>([]);
  const [sectionLines, setSectionLines] = useState<SectionLine[]>([]);
  const [shafts, setShafts] = useState<Shaft[]>([]);
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);

  const [showRooms, setShowRooms] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [pendingLibraryItem, setPendingLibraryItem] = useState<LibraryItem | null>(null);
  const [materialPickerWallId, setMaterialPickerWallId] = useState<string | null>(null);

  const { selection, setSelection, explodedView, mobileViewMode, setMobileViewMode } =
    useDesignStudioStore();
  const { t } = useI18nStore();
  const currentFloorLevel = floors.find((f) => f.id === floorId)?.level ?? 0;

  useEffect(() => {
    return subscribeToBuildings(projectId, (bs) => {
      setBuildings(bs);
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
      setHasLoadedBuildings(true);
    });
  }, [projectId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToFloors(projectId, buildingId, (fs) => {
      setFloors(fs);
      setFloorId((current) => current ?? fs[0]?.id ?? null);
    });
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToShafts(projectId, buildingId, setShafts);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSiteBoundary(projectId, buildingId, setSiteBoundary);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId || !floorId) return;
    const unsubs = [
      subscribeToWalls(projectId, buildingId, floorId, setWalls),
      subscribeToOpenings(projectId, buildingId, floorId, setOpenings),
      subscribeToColumns(projectId, buildingId, floorId, setColumns),
      subscribeToBeams(projectId, buildingId, floorId, setBeams),
      subscribeToSlabs(projectId, buildingId, floorId, setSlabs),
      ceilingCrud.subscribe(projectId, buildingId, floorId, setCeilings),
      foundationCrud.subscribe(projectId, buildingId, floorId, setFoundations),
      footingCrud.subscribe(projectId, buildingId, floorId, setFootings),
      roofCrud.subscribe(projectId, buildingId, floorId, setRoofs),
      rampCrud.subscribe(projectId, buildingId, floorId, setRamps),
      railingCrud.subscribe(projectId, buildingId, floorId, setRailings),
      stairCrud.subscribe(projectId, buildingId, floorId, setStairs),
      balconyCrud.subscribe(projectId, buildingId, floorId, setBalconies),
      curtainWallCrud.subscribe(projectId, buildingId, floorId, setCurtainWalls),
      skylightCrud.subscribe(projectId, buildingId, floorId, setSkylights),
      placedObjectCrud.subscribe(projectId, buildingId, floorId, setPlacedObjects),
      subscribeToRooms(projectId, buildingId, floorId, setRooms),
      dimensionCrud.subscribe(projectId, buildingId, floorId, setDimensions),
      noteCrud.subscribe(projectId, buildingId, floorId, setNotes),
      gridLineCrud.subscribe(projectId, buildingId, floorId, setGridLines),
      sectionLineCrud.subscribe(projectId, buildingId, floorId, setSectionLines),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floorId]);

  // Smart Room System: re-detect rooms whenever the wall set settles.
  // Debounced so a drag-in-progress doesn't fire a Firestore write per frame.
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!buildingId || !floorId) return;
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => {
      reconcileRooms(projectId, buildingId, floorId, walls).catch(() => {
        // Best-effort — a failed reconciliation just means rooms are stale
        // until the next wall edit retries it.
      });
    }, 600);
    return () => {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, buildingId, floorId, walls]);

  async function rejoinAfter(newWall: { id: string; start: { x: number; y: number }; end: { x: number; y: number } }) {
    if (!buildingId || !floorId) return;
    const existingEndpoints = walls
      .filter((w) => w.id !== newWall.id)
      .map((w) => ({ id: w.id, start: w.start, end: w.end }));
    const joined = joinCoincidentEndpoints([...existingEndpoints, newWall]);
    const changed = joined.filter((w) => w.id !== newWall.id);
    if (changed.length > 0) {
      await updateWallsBatch(projectId, buildingId, floorId, changed);
    }
  }

  async function handleCreateWall(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    await createWall(projectId, buildingId, floorId, {
      start,
      end,
      thickness: DEFAULT_WALL_THICKNESS,
      height: DEFAULT_WALL_HEIGHT,
      type: 'INTERIOR',
    });
    await rejoinAfter({ id: '__pending__', start, end });
  }

  async function handleCreateBeam(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    await createBeam(projectId, buildingId, floorId, {
      start,
      end,
      width: DEFAULT_BEAM_WIDTH,
      depth: DEFAULT_BEAM_DEPTH,
      elevation: DEFAULT_WALL_HEIGHT - DEFAULT_BEAM_DEPTH,
    });
  }

  async function handleCreateColumn(center: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    await createColumn(projectId, buildingId, floorId, {
      center,
      shape: 'RECTANGULAR',
      width: DEFAULT_COLUMN_WIDTH,
      depth: DEFAULT_COLUMN_DEPTH,
      height: DEFAULT_COLUMN_HEIGHT,
    });
  }

  async function handleCreateFooting(center: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    await footingCrud.create(projectId, buildingId, floorId, {
      center,
      width: DEFAULT_FOOTING_WIDTH,
      depth: DEFAULT_FOOTING_DEPTH,
      thickness: DEFAULT_FOOTING_THICKNESS,
      elevation: -1.2 - DEFAULT_FOOTING_THICKNESS,
    });
  }

  function rectBoundary(corner1: { x: number; y: number }, corner2: { x: number; y: number }) {
    return [
      { x: corner1.x, y: corner1.y },
      { x: corner2.x, y: corner1.y },
      { x: corner2.x, y: corner2.y },
      { x: corner1.x, y: corner2.y },
    ];
  }

  async function handleCreateRectangle(
    tool: 'slab' | 'ceiling' | 'foundation' | 'roof' | 'balcony' | 'shaft' | 'siteBoundary',
    corner1: { x: number; y: number },
    corner2: { x: number; y: number },
  ) {
    if (!buildingId || !floorId) return;
    if (Math.abs(corner2.x - corner1.x) < 0.05 || Math.abs(corner2.y - corner1.y) < 0.05) return;
    const boundary = rectBoundary(corner1, corner2);

    if (tool === 'slab') {
      await createSlab(projectId, buildingId, floorId, {
        boundary,
        thickness: DEFAULT_SLAB_THICKNESS,
        elevation: 0,
      });
    } else if (tool === 'ceiling') {
      await ceilingCrud.create(projectId, buildingId, floorId, {
        boundary,
        thickness: DEFAULT_CEILING_THICKNESS,
        elevation: DEFAULT_WALL_HEIGHT - DEFAULT_CEILING_THICKNESS,
      });
    } else if (tool === 'foundation') {
      await foundationCrud.create(projectId, buildingId, floorId, {
        boundary,
        thickness: DEFAULT_FOUNDATION_THICKNESS,
        elevation: -DEFAULT_FOUNDATION_THICKNESS - 0.3,
      });
    } else if (tool === 'roof') {
      await roofCrud.create(projectId, buildingId, floorId, {
        boundary,
        thickness: DEFAULT_ROOF_THICKNESS,
        elevation: DEFAULT_WALL_HEIGHT,
      });
    } else if (tool === 'balcony') {
      await balconyCrud.create(projectId, buildingId, floorId, {
        boundary,
        thickness: DEFAULT_BALCONY_THICKNESS,
        elevation: 0,
      });
    } else if (tool === 'shaft') {
      // Shaft is building-level (spans multiple floors), unlike every
      // other rectangle tool here — defaults to just the current floor's
      // level; the person expands startLevel/endLevel afterward in
      // PropertiesPanel once they know how many floors it should span.
      await createShaft(projectId, buildingId, {
        boundary,
        shaftType: 'ELEVATOR',
        startLevel: currentFloorLevel,
        endLevel: currentFloorLevel,
      });
    } else if (tool === 'siteBoundary') {
      // A building has at most one plot boundary — drawing a new one
      // replaces whichever one was there before, rather than piling up
      // rectangles the person has to manually clean up.
      if (siteBoundary) {
        await deleteSiteBoundary(projectId, buildingId, siteBoundary.id);
      }
      await createSiteBoundary(projectId, buildingId, {
        boundary,
        frontEdge: 'top',
      });
    }
  }

  async function handleCreateRamp(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    await rampCrud.create(projectId, buildingId, floorId, {
      start,
      end,
      startElevation: 0,
      endElevation: DEFAULT_RAMP_RISE,
      width: DEFAULT_RAMP_WIDTH,
      thickness: DEFAULT_RAMP_THICKNESS,
    });
  }

  async function handleCreateRailing(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    await railingCrud.create(projectId, buildingId, floorId, {
      start,
      end,
      height: DEFAULT_RAILING_HEIGHT,
      postSpacing: DEFAULT_RAILING_POST_SPACING,
    });
  }

  async function handleCreateStair(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.3) return;
    await stairCrud.create(projectId, buildingId, floorId, {
      start,
      end,
      width: DEFAULT_STAIR_WIDTH,
      numberOfSteps: DEFAULT_STAIR_STEPS,
      riserHeight: DEFAULT_STAIR_RISER_HEIGHT,
    });
  }

  async function handleCreateCurtainWall(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    await curtainWallCrud.create(projectId, buildingId, floorId, {
      start,
      end,
      height: DEFAULT_CURTAIN_WALL_HEIGHT,
      thickness: DEFAULT_CURTAIN_WALL_THICKNESS,
      mullionSpacing: DEFAULT_MULLION_SPACING,
    });
  }

  async function handleCreateSkylight(roofId: string, center: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    await skylightCrud.create(projectId, buildingId, floorId, {
      roofId,
      center,
      width: DEFAULT_SKYLIGHT_WIDTH,
      depth: DEFAULT_SKYLIGHT_DEPTH,
    });
  }

  async function handleCreatePlacedObject(category: PlacedObjectCategory, center: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    const useLibraryItem = pendingLibraryItem && LIBRARY_CATEGORY_FOR_PLACED[category] === pendingLibraryItem.category;
    const defaults = PLACED_OBJECT_DEFAULTS[category];
    await placedObjectCrud.create(projectId, buildingId, floorId, {
      category,
      center,
      label: useLibraryItem ? pendingLibraryItem!.name : defaults.label,
      rotationDeg: 0,
      width: useLibraryItem ? pendingLibraryItem!.defaultWidth : defaults.width,
      depth: useLibraryItem ? (pendingLibraryItem!.defaultDepth ?? defaults.depth) : defaults.depth,
      height: useLibraryItem ? pendingLibraryItem!.defaultHeight : defaults.height,
    });
  }

  async function handleCreateDimension(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    await dimensionCrud.create(projectId, buildingId, floorId, {
      start,
      end,
      offset: 0.4,
    });
  }

  async function handleCreateNote(position: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    await noteCrud.create(projectId, buildingId, floorId, {
      position,
      text: 'Note',
    });
  }

  async function handleCreateGridLine(orientation: 'vertical' | 'horizontal', position: number) {
    if (!buildingId || !floorId) return;
    await gridLineCrud.create(projectId, buildingId, floorId, {
      orientation,
      position,
    });
  }

  async function handleCreateSectionLine(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    await sectionLineCrud.create(projectId, buildingId, floorId, {
      start,
      end,
      viewDirection: 'left',
    });
  }

  function handleViewSection(sectionLineId: string) {
    router.push(`/projects/${projectId}/sections/${sectionLineId}?buildingId=${buildingId}`);
  }

  function handleOpenElevation(direction: 'N' | 'E' | 'S' | 'W') {
    router.push(`/projects/${projectId}/elevations?direction=${direction}`);
  }

  async function handleCreateOpening(
    wallId: string,
    positionOnWall: number,
    kind: 'DOOR' | 'WINDOW',
  ) {
    if (!buildingId || !floorId) return;
    const useLibraryItem = pendingLibraryItem && pendingLibraryItem.category === kind;
    await createOpening(projectId, buildingId, floorId, {
      wallId,
      kind,
      positionOnWall,
      width: useLibraryItem ? pendingLibraryItem!.defaultWidth : kind === 'DOOR' ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH,
      height: useLibraryItem ? pendingLibraryItem!.defaultHeight : kind === 'DOOR' ? DEFAULT_DOOR_HEIGHT : DEFAULT_WINDOW_HEIGHT,
      sillHeight: kind === 'DOOR' ? 0 : DEFAULT_WINDOW_SILL_HEIGHT,
    });
  }

  async function handleMoveWallEndpoint(
    wallId: string,
    end: 'start' | 'end',
    point: { x: number; y: number },
  ) {
    if (!buildingId || !floorId) return;
    await updateWall(projectId, buildingId, floorId, wallId, { [end]: point });
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) return;
    const updated = end === 'start' ? { ...wall, start: point } : { ...wall, end: point };
    await rejoinAfter({ id: wallId, start: updated.start, end: updated.end });
  }

  async function handleDeleteSelection() {
    if (!buildingId || !floorId || !selection) return;
    const { kind, id } = selection;
    if (kind === 'wall') await deleteWall(projectId, buildingId, floorId, id);
    if (kind === 'opening') await deleteOpening(projectId, buildingId, floorId, id);
    if (kind === 'column') await deleteColumn(projectId, buildingId, floorId, id);
    if (kind === 'beam') await deleteBeam(projectId, buildingId, floorId, id);
    if (kind === 'slab') await deleteSlab(projectId, buildingId, floorId, id);
    if (kind === 'ceiling') await ceilingCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'foundation') await foundationCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'footing') await footingCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'roof') await roofCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'ramp') await rampCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'railing') await railingCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'stair') await stairCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'balcony') await balconyCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'curtainWall') await curtainWallCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'skylight') await skylightCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'placedObject') await placedObjectCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'dimension') await dimensionCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'note') await noteCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'gridLine') await gridLineCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'sectionLine') await sectionLineCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'shaft') await deleteShaft(projectId, buildingId, id);
    if (kind === 'siteBoundary') await deleteSiteBoundary(projectId, buildingId, id);
    setSelection(null);
  }

  if (hasLoadedBuildings && buildings.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="font-display text-lg font-medium text-ink">
          {t.designStudio.noBuildingsTitle}
        </h2>
        <p className="max-w-sm text-sm text-ink-muted">{t.designStudio.noBuildingsMessage}</p>
        <Link href={`/projects/${projectId}`}>
          <Button>{t.designStudio.goToProjectOverview}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-surface px-3 py-3 sm:px-6">
        <PageHeader
          title={t.designStudio.pageTitle}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {pendingLibraryItem && (
                <span className="rounded-sheet bg-accent-soft px-2 py-1 font-mono text-[11px] text-accent-dark">
                  {formatTemplate(t.designStudio.usingLibraryItem, { name: pendingLibraryItem.name })}
                  <button className="ml-2" onClick={() => setPendingLibraryItem(null)}>
                    ✕
                  </button>
                </span>
              )}
              <select
                value={buildingId ?? ''}
                onChange={(e) => {
                  setBuildingId(e.target.value);
                  setFloorId(null);
                }}
                className="min-w-0 max-w-full rounded-sheet border border-line-strong px-2 py-1 text-sm"
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                value={floorId ?? ''}
                onChange={(e) => setFloorId(e.target.value)}
                className="min-w-0 max-w-full rounded-sheet border border-line-strong px-2 py-1 text-sm"
              >
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center rounded-sheet border border-line-strong p-0.5 lg:hidden">
                <button
                  onClick={() => setMobileViewMode('2d')}
                  className={clsx(
                    'rounded-sheet px-2.5 py-1 text-xs font-medium transition-colors',
                    mobileViewMode === '2d' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {t.designStudio.view2D}
                </button>
                <button
                  onClick={() => setMobileViewMode('3d')}
                  className={clsx(
                    'rounded-sheet px-2.5 py-1 text-xs font-medium transition-colors',
                    mobileViewMode === '3d' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {t.designStudio.view3D}
                </button>
              </div>
            </div>
          }
        />
      </div>

      <Toolbar
        onDeleteSelection={handleDeleteSelection}
        onOpenRooms={() => setShowRooms(true)}
        onOpenLibrary={() => setShowLibrary(true)}
        roomCount={rooms.length}
      />

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden bg-paper p-3 lg:flex-row lg:overflow-hidden">
        <div
          className={clsx(
            'relative min-h-[420px] flex-1 lg:min-h-0 lg:block',
            mobileViewMode === '2d' ? 'block' : 'hidden',
          )}
        >
          <FloorPlanCanvas
            walls={walls}
            openings={openings}
            columns={columns}
            beams={beams}
            slabs={slabs}
            ceilings={ceilings}
            foundations={foundations}
            footings={footings}
            roofs={roofs}
            ramps={ramps}
            railings={railings}
            stairs={stairs}
            balconies={balconies}
            curtainWalls={curtainWalls}
            skylights={skylights}
            placedObjects={placedObjects}
            rooms={rooms}
            dimensions={dimensions}
            notes={notes}
            gridLines={gridLines}
            sectionLines={sectionLines}
            shafts={shafts}
            siteBoundary={siteBoundary}
            currentFloorLevel={currentFloorLevel}
            onCreateWall={handleCreateWall}
            onCreateBeam={handleCreateBeam}
            onCreateColumn={handleCreateColumn}
            onCreateFooting={handleCreateFooting}
            onCreateRectangle={handleCreateRectangle}
            onCreateRamp={handleCreateRamp}
            onCreateRailing={handleCreateRailing}
            onCreateStair={handleCreateStair}
            onCreateCurtainWall={handleCreateCurtainWall}
            onCreateSkylight={handleCreateSkylight}
            onCreatePlacedObject={handleCreatePlacedObject}
            onCreateOpening={handleCreateOpening}
            onCreateDimension={handleCreateDimension}
            onCreateNote={handleCreateNote}
            onCreateGridLine={handleCreateGridLine}
            onCreateSectionLine={handleCreateSectionLine}
            onOpenElevation={handleOpenElevation}
            onMoveWallEndpoint={handleMoveWallEndpoint}
          />
          <PropertiesPanel
            walls={walls}
            openings={openings}
            columns={columns}
            beams={beams}
            slabs={slabs}
            ceilings={ceilings}
            foundations={foundations}
            footings={footings}
            roofs={roofs}
            ramps={ramps}
            railings={railings}
            stairs={stairs}
            balconies={balconies}
            curtainWalls={curtainWalls}
            skylights={skylights}
            placedObjects={placedObjects}
            dimensions={dimensions}
            notes={notes}
            gridLines={gridLines}
            sectionLines={sectionLines}
            shafts={shafts}
            siteBoundary={siteBoundary}
            onUpdateWall={(id, patch) =>
              buildingId && floorId && updateWall(projectId, buildingId, floorId, id, patch)
            }
            onUpdateOpening={(id, patch) =>
              buildingId && floorId && updateOpening(projectId, buildingId, floorId, id, patch)
            }
            onUpdateColumn={(id, patch) =>
              buildingId && floorId && updateColumn(projectId, buildingId, floorId, id, patch)
            }
            onUpdateBeam={(id, patch) =>
              buildingId && floorId && updateBeam(projectId, buildingId, floorId, id, patch)
            }
            onUpdateSlab={(id, patch) =>
              buildingId && floorId && updateSlab(projectId, buildingId, floorId, id, patch)
            }
            onUpdateCeiling={(id, patch) =>
              buildingId && floorId && ceilingCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateFoundation={(id, patch) =>
              buildingId && floorId && foundationCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateFooting={(id, patch) =>
              buildingId && floorId && footingCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateRoof={(id, patch) =>
              buildingId && floorId && roofCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateRamp={(id, patch) =>
              buildingId && floorId && rampCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateRailing={(id, patch) =>
              buildingId && floorId && railingCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateStair={(id, patch) =>
              buildingId && floorId && stairCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateBalcony={(id, patch) =>
              buildingId && floorId && balconyCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateCurtainWall={(id, patch) =>
              buildingId && floorId && curtainWallCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateSkylight={(id, patch) =>
              buildingId && floorId && skylightCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdatePlacedObject={(id, patch) =>
              buildingId && floorId && placedObjectCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateDimension={(id, patch) =>
              buildingId && floorId && dimensionCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateNote={(id, patch) =>
              buildingId && floorId && noteCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateGridLine={(id, patch) =>
              buildingId && floorId && gridLineCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateSectionLine={(id, patch) =>
              buildingId && floorId && sectionLineCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onViewSection={handleViewSection}
            onUpdateShaft={(id, patch) => buildingId && updateShaft(projectId, buildingId, id, patch)}
            onUpdateSiteBoundary={(id, patch) => buildingId && updateSiteBoundary(projectId, buildingId, id, patch)}
            onOpenMaterialLibrary={(wallId) => {
              setMaterialPickerWallId(wallId);
              setShowLibrary(true);
            }}
            onDelete={handleDeleteSelection}
          />
          {showRooms && (
            <RoomListPanel
              rooms={rooms}
              onClose={() => setShowRooms(false)}
              onUpdateRoom={(id, patch) =>
                buildingId && floorId && updateRoom(projectId, buildingId, floorId, id, patch)
              }
            />
          )}
          {showLibrary && user && (
            <LibraryBrowser
              currentUserId={user.uid}
              initialCategory={materialPickerWallId ? 'MATERIAL' : undefined}
              onClose={() => {
                setShowLibrary(false);
                setMaterialPickerWallId(null);
              }}
              onSelect={(item) => {
                if (materialPickerWallId && buildingId && floorId) {
                  updateWall(projectId, buildingId, floorId, materialPickerWallId, {
                    materialLabel: item.name,
                    libraryItemId: item.id,
                  });
                  setMaterialPickerWallId(null);
                } else {
                  setPendingLibraryItem(item);
                }
                setShowLibrary(false);
              }}
            />
          )}
        </div>
        <div
          className={clsx(
            'min-h-[360px] flex-1 lg:min-h-0 lg:block',
            mobileViewMode === '3d' ? 'block' : 'hidden',
          )}
        >
          <Live3DView
            walls={walls}
            openings={openings}
            columns={columns}
            beams={beams}
            slabs={slabs}
            ceilings={ceilings}
            foundations={foundations}
            footings={footings}
            roofs={roofs}
            ramps={ramps}
            railings={railings}
            stairs={stairs}
            balconies={balconies}
            curtainWalls={curtainWalls}
            skylights={skylights}
            placedObjects={placedObjects}
            rooms={rooms}
            explodedView={explodedView}
          />
        </div>
      </div>
    </div>
  );
}

// Maps a PlacedObject category to the matching LibraryCategory, since the
// two enums are named slightly differently in a couple of spots and this
// keeps the "use library defaults" check in one place.
const LIBRARY_CATEGORY_FOR_PLACED: Record<PlacedObjectCategory, string> = {
  FURNITURE: 'FURNITURE',
  KITCHEN: 'KITCHEN',
  BATHROOM: 'BATHROOM',
  PARKING: 'VEHICLE',
  LANDSCAPE: 'LANDSCAPE',
};
