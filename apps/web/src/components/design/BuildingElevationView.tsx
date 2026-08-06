'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Floor, LibraryItem } from '@archibim/object-model';
import { computeFloorBaseElevations } from '@archibim/core-engine';
import type { FloorElements } from '@/lib/floors';
import { numberToLetters } from '@/lib/floors';
import { buildMaterialLookup, resolveMaterial } from '@/lib/material-resolver';
import {
  WallMesh,
  OpeningMarker,
  ColumnMesh,
  BeamMesh,
  PlanarBoxMesh,
  FootingMesh,
  RampMesh,
  RailingMesh,
  StairMesh,
  CurtainWallMesh,
  SkylightMesh,
} from './Live3DView';

export type ElevationDirection = 'N' | 'S' | 'E' | 'W';

export interface BuildingElevationViewProps {
  floors: Floor[];
  floorElements: Record<string, FloorElements>;
  direction: ElevationDirection;
  height?: number;
  /** Phase A — Elevation/Render material fidelity: same resolved-material
   * source as Live3DView/BuildingRenderStudioView. Optional/defaults to
   * empty so this view keeps working unchanged if a caller hasn't wired
   * the library subscription up yet. */
  libraryItems?: LibraryItem[];
  /** Shows a horizontal datum line + label at each floor's base height —
   * the "Levels" annotation, derived live from Floor data (no separate
   * placed object, same idea as Room Tags reusing Room data). Defaults
   * to on since it's genuinely useful reference info, not clutter. */
  showLevels?: boolean;
  /** Fires whenever the underlying WebGL canvas element and/or the
   * camera's effective world-units-per-pixel changes — used by the
   * Sheet export flow both to capture this view as an image AND to know
   * the true scale of that capture, so the PDF can be composed at an
   * exact printed scale instead of just aspect-fit into the page (see
   * lib/sheet-export.ts). Needs the renderer's preserveDrawingBuffer (set
   * below) or the capture would come back blank — a well-known Three.js/
   * WebGL screenshot gotcha, not optional here. Fires on every zoom/pan
   * frame (not just once on mount) because OrbitControls lets the person
   * change zoom after this view loads — export always reads whatever
   * scale is on screen at click time, same as Revit's "current viewport
   * scale" behavior.
   */
  onCanvasReady?: (canvas: HTMLCanvasElement, metersPerPixel: number) => void;
}

/** Reports the live canvas element plus how many world-units (meters, in
 * this app's convention) one CAPTURED pixel represents — i.e. one pixel
 * of the canvas's actual backing buffer (canvasEl.width/height, what
 * toDataURL() reads), not one CSS/logical pixel.
 *
 * `1 / zoom` from OrthographicCamera gives world-units per CSS pixel
 * (drei sizes the frustum to the canvas's CSS width/height). But this
 * Canvas renders at `dpr={[1, 1.5]}` — the renderer can back the same
 * CSS size with up to 1.5x as many actual pixels depending on the
 * device's pixel ratio. Dividing by gl.getPixelRatio() converts
 * world-units-per-CSS-pixel into world-units-per-BACKING-pixel, which
 * is the number sheet-export.ts actually needs since it multiplies by
 * image.width/height (the captured canvas's real pixel dimensions, always
 * CSS size * pixel ratio). Skipping this division was silently wrong on
 * any screen with devicePixelRatio > 1: true-scale placement either
 * undersized the drawing or rejected it as "doesn't fit" and fell back
 * to aspect-fit. */
function CanvasRefBridge({ onReady }: { onReady?: (canvas: HTMLCanvasElement, metersPerPixel: number) => void }) {
  const { gl, camera } = useThree();
  const lastReported = useRef<number | null>(null);
  useFrame(() => {
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
    const pixelRatio = gl.getPixelRatio() || 1;
    const metersPerPixel = 1 / zoom / pixelRatio;
    // Compare with a small epsilon rather than strict equality — zoom is
    // a float that OrbitControls nudges continuously while the person is
    // actively dragging/scrolling, so exact equality would still fire
    // every frame during interaction. Only report real, visually
    // meaningful changes.
    if (lastReported.current === null || Math.abs(lastReported.current - metersPerPixel) > 1e-6) {
      lastReported.current = metersPerPixel;
      onReady?.(gl.domElement, metersPerPixel);
    }
  });
  return null;
}

/**
 * True orthographic elevation of a whole building — every floor stacked
 * at its real height (via computeFloorBaseElevations), viewed with an
 * orthographic camera locked to one cardinal direction (no perspective
 * distortion, so it's to-scale like a real elevation drawing, not just
 * another angle on the perspective 3D view).
 *
 * Reuses the exact same per-element-type mesh components as Live3DView
 * (WallMesh, ColumnMesh, etc.) so any future geometry improvement there
 * — e.g. real CSG door/window cutouts — applies here automatically too.
 *
 * Deliberately excludes Rooms (name/area labels) and PlacedObjects
 * (furniture) — both are interior-only concerns that would just clutter
 * an exterior elevation, unlike every other element type here which
 * genuinely can appear on a building's exterior silhouette.
 */
export function BuildingElevationView({
  floors,
  floorElements,
  direction,
  height = 600,
  showLevels = true,
  onCanvasReady,
  libraryItems = [],
}: BuildingElevationViewProps) {
  const baseElevations = useMemo(() => computeFloorBaseElevations(floors), [floors]);
  const materialLookup = useMemo(() => buildMaterialLookup(libraryItems), [libraryItems]);

  const bounds = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxTop = 3;
    for (const floor of floors) {
      const elements = floorElements[floor.id];
      if (!elements) continue;
      const base = baseElevations.get(floor.id) ?? 0;
      for (const w of elements.walls) {
        for (const p of [w.start, w.end]) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.y);
          maxZ = Math.max(maxZ, p.y);
        }
        maxTop = Math.max(maxTop, base + w.height);
      }
    }
    if (!Number.isFinite(minX)) return { centerX: 0, centerZ: 0, spanX: 10, spanZ: 10, maxTop: 3 };
    return {
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      spanX: Math.max(5, maxX - minX),
      spanZ: Math.max(5, maxZ - minZ),
      maxTop,
    };
  }, [floors, floorElements, baseElevations]);

  // Phase C — Sheet annotation: grid bubbles. A grid line is defined
  // per-floor (see GridLine's own comment) but in practice the same grid
  // runs through every floor of a building, so this dedupes by
  // (orientation, position) across all floors to get one building-wide
  // set — a line added on only one floor still shows up here rather than
  // being missed. Only the axis that reads as "left-to-right" for this
  // camera direction is shown, same as the reference elevation sheets
  // (a north/south elevation shows the numbered verticals; an east/west
  // elevation shows the lettered horizontals) — showing both would just
  // be two overlapping bubble rows for an axis that's edge-on to this view.
  const relevantGridLines = useMemo(() => {
    const wantOrientation = direction === 'N' || direction === 'S' ? 'vertical' : 'horizontal';
    const seen = new Map<number, { position: number; label: string }>();
    for (const floor of floors) {
      const lines = floorElements[floor.id]?.gridLines ?? [];
      const sameOrientation = lines.filter((l) => l.orientation === wantOrientation);
      sameOrientation.forEach((line, index) => {
        const key = Math.round(line.position * 1000); // dedupe by position, mm precision
        if (seen.has(key)) return;
        const label = line.label ?? (wantOrientation === 'vertical' ? String(index + 1) : numberToLetters(index));
        seen.set(key, { position: line.position, label });
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.position - b.position);
  }, [floors, floorElements, direction]);

  const far = Math.max(bounds.spanX, bounds.spanZ, bounds.maxTop) * 4 + 50;
  const midY = bounds.maxTop / 2;
  const cameraPosition: [number, number, number] =
    direction === 'N'
      ? [bounds.centerX, midY, bounds.centerZ + far]
      : direction === 'S'
        ? [bounds.centerX, midY, bounds.centerZ - far]
        : direction === 'E'
          ? [bounds.centerX + far, midY, bounds.centerZ]
          : [bounds.centerX - far, midY, bounds.centerZ];

  // Heuristic default framing — fits the building's footprint/height
  // into the viewport with some margin; the person can still scroll/pinch
  // to zoom and drag to pan (rotation is locked, unlike the free 3D view).
  const relevantSpan = direction === 'N' || direction === 'S' ? bounds.spanX : bounds.spanZ;
  const zoom = Math.max(10, Math.min(80, 500 / Math.max(relevantSpan, bounds.maxTop * 1.5, 1)));

  // Level line endpoints — drawn just outside the building envelope, on
  // the camera-facing side, spanning whichever world axis reads as
  // "horizontal" for this cardinal direction.
  const levelLineOffset = 1.5;
  const halfX = bounds.spanX / 2 + 1;
  const halfZ = bounds.spanZ / 2 + 1;
  const levelLineEndpoints = (): [[number, number, number], [number, number, number]] => {
    if (direction === 'N') {
      const z = bounds.centerZ + bounds.spanZ / 2 + levelLineOffset;
      return [
        [bounds.centerX - halfX, 0, z],
        [bounds.centerX + halfX, 0, z],
      ];
    }
    if (direction === 'S') {
      const z = bounds.centerZ - bounds.spanZ / 2 - levelLineOffset;
      return [
        [bounds.centerX - halfX, 0, z],
        [bounds.centerX + halfX, 0, z],
      ];
    }
    if (direction === 'E') {
      const x = bounds.centerX + bounds.spanX / 2 + levelLineOffset;
      return [
        [x, 0, bounds.centerZ - halfZ],
        [x, 0, bounds.centerZ + halfZ],
      ];
    }
    const x = bounds.centerX - bounds.spanX / 2 - levelLineOffset;
    return [
      [x, 0, bounds.centerZ - halfZ],
      [x, 0, bounds.centerZ + halfZ],
    ];
  };
  const [levelA, levelB] = levelLineEndpoints();

  return (
    <div style={{ height }} className="overflow-hidden rounded-sheet border border-line bg-[#F6F7F9]">
      <Canvas gl={{ preserveDrawingBuffer: true, powerPreference: 'high-performance' }} dpr={[1, 1.5]}>
        <CanvasRefBridge onReady={onCanvasReady} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[15, 20, 10]} intensity={0.6} />
        <OrthographicCamera makeDefault position={cameraPosition} zoom={zoom} near={0.1} far={far * 2} />

        {floors.map((floor) => {
          const elements = floorElements[floor.id];
          if (!elements) return null;
          const base = baseElevations.get(floor.id) ?? 0;
          const extendedSegments = elements.walls.map((w) => ({ wallId: w.id, start: w.start, end: w.end }));
          return (
            <group key={floor.id} position={[0, base, 0]}>
              {elements.foundations.map((f) => (
                <PlanarBoxMesh
                  key={f.id}
                  boundary={f.boundary}
                  thickness={f.thickness}
                  elevation={f.elevation}
                  color="#9AA3B2"
                  selectedColor="#9AA3B2"
                  selected={false}
                />
              ))}
              {elements.footings.map((f) => (
                <FootingMesh key={f.id} footing={f} selected={false} />
              ))}
              {elements.slabs.map((slab) => (
                <PlanarBoxMesh
                  key={slab.id}
                  boundary={slab.boundary}
                  thickness={slab.thickness}
                  elevation={slab.elevation}
                  color="#D8DEE9"
                  selectedColor="#D8DEE9"
                  selected={false}
                />
              ))}
              {elements.walls.map((wall) => {
                const segment = extendedSegments.find((s) => s.wallId === wall.id) ?? wall;
                const material = resolveMaterial(wall, materialLookup, '#E7E9EE');
                return (
                  <WallMesh
                    key={wall.id}
                    wall={wall}
                    segment={segment}
                    selected={false}
                    colorOverride={material.color}
                    roughness={material.roughness}
                    metalness={material.metalness}
                  />
                );
              })}
              {elements.openings.map((opening) => {
                const wall = elements.walls.find((w) => w.id === opening.wallId);
                return wall ? <OpeningMarker key={opening.id} opening={opening} wall={wall} /> : null;
              })}
              {elements.columns.map((column) => (
                <ColumnMesh key={column.id} column={column} selected={false} />
              ))}
              {elements.beams.map((beam) => (
                <BeamMesh key={beam.id} beam={beam} selected={false} />
              ))}
              {elements.ceilings.map((c) => (
                <PlanarBoxMesh
                  key={c.id}
                  boundary={c.boundary}
                  thickness={c.thickness}
                  elevation={c.elevation}
                  color="#EDEFF3"
                  selectedColor="#EDEFF3"
                  selected={false}
                />
              ))}
              {elements.roofs.map((r) => {
                const material = resolveMaterial(r, materialLookup, '#8B5E4A');
                return (
                  <PlanarBoxMesh
                    key={r.id}
                    boundary={r.boundary}
                    thickness={r.thickness}
                    elevation={r.elevation}
                    color={material.color}
                    selectedColor={material.color}
                    selected={false}
                    roughness={material.roughness}
                    metalness={material.metalness}
                  />
                );
              })}
              {elements.ramps.map((r) => (
                <RampMesh key={r.id} ramp={r} selected={false} />
              ))}
              {elements.railings.map((r) => (
                <RailingMesh key={r.id} railing={r} selected={false} />
              ))}
              {elements.stairs.map((s) => (
                <StairMesh key={s.id} stair={s} selected={false} />
              ))}
              {elements.balconies.map((b) => (
                <PlanarBoxMesh
                  key={b.id}
                  boundary={b.boundary}
                  thickness={b.thickness}
                  elevation={b.elevation}
                  color="#B7C0D1"
                  selectedColor="#B7C0D1"
                  selected={false}
                />
              ))}
              {elements.curtainWalls.map((cw) => (
                <CurtainWallMesh key={cw.id} curtainWall={cw} selected={false} />
              ))}
              {elements.skylights.map((sky) => {
                const roof = elements.roofs.find((r) => r.id === sky.roofId);
                if (!roof) return null;
                return (
                  <SkylightMesh key={sky.id} skylight={sky} topElevation={roof.elevation + roof.thickness} />
                );
              })}
            </group>
          );
        })}

        {relevantGridLines.map((line) => {
          // Map this grid line's 1D position (meters, along whichever
          // world axis is "horizontal" for this camera direction) into
          // the 3D coordinate the OTHER two axes need to stay fixed at —
          // running the full height of the building, on the camera-facing
          // face so it's never occluded by the building itself.
          const bubbleTop = bounds.maxTop + 1.2;
          let start: [number, number, number];
          let end: [number, number, number];
          let bubblePos: [number, number, number];
          if (direction === 'N') {
            start = [line.position, 0, bounds.centerZ + bounds.spanZ / 2 + levelLineOffset];
            end = [line.position, bubbleTop, bounds.centerZ + bounds.spanZ / 2 + levelLineOffset];
            bubblePos = end;
          } else if (direction === 'S') {
            start = [line.position, 0, bounds.centerZ - bounds.spanZ / 2 - levelLineOffset];
            end = [line.position, bubbleTop, bounds.centerZ - bounds.spanZ / 2 - levelLineOffset];
            bubblePos = end;
          } else if (direction === 'E') {
            start = [bounds.centerX + bounds.spanX / 2 + levelLineOffset, 0, line.position];
            end = [bounds.centerX + bounds.spanX / 2 + levelLineOffset, bubbleTop, line.position];
            bubblePos = end;
          } else {
            start = [bounds.centerX - bounds.spanX / 2 - levelLineOffset, 0, line.position];
            end = [bounds.centerX - bounds.spanX / 2 - levelLineOffset, bubbleTop, line.position];
            bubblePos = end;
          }
          return (
            <group key={`grid-${line.label}`}>
              <Line points={[start, end]} color="#9AA3B2" lineWidth={1} dashed dashSize={0.25} gapSize={0.15} />
              <Html position={bubblePos} center occlude={false}>
                <div className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-full border border-ink-muted bg-white font-mono text-[11px] font-semibold text-ink shadow-sm">
                  {line.label}
                </div>
              </Html>
            </group>
          );
        })}

        {showLevels &&
          floors.map((floor, floorIndex) => {
            const base = baseElevations.get(floor.id) ?? 0;
            const a: [number, number, number] = [levelA[0], base, levelA[2]];
            const b: [number, number, number] = [levelB[0], base, levelB[2]];
            const labelPos: [number, number, number] = [b[0], base, b[2]];
            return (
              <group key={`level-${floor.id}`}>
                <Line points={[a, b]} color="#7A8599" lineWidth={1} dashed dashSize={0.3} gapSize={0.2} />
                <Html position={labelPos} center={false} occlude={false}>
                  <div className="pointer-events-none flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-muted bg-white font-mono text-[9px] font-semibold text-ink shadow-sm">
                      {floorIndex + 1}
                    </div>
                    <div className="rounded bg-white/85 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted shadow-sm">
                      {floor.name} {base >= 0 ? '+' : ''}
                      {base.toFixed(2)}m
                    </div>
                  </div>
                </Html>
              </group>
            );
          })}

        <OrbitControls
          target={[bounds.centerX, midY, bounds.centerZ]}
          enableRotate={false}
          makeDefault
        />
      </Canvas>
    </div>
  );
}
