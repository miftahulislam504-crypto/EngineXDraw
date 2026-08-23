'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Balcony, Floor, LibraryItem, Parapet, Railing, SectionLine } from '@archibim/object-model';
import { computeFloorBaseElevations, formatFeetInches, treadDepth, stairReferencePoint, pointAtParameter } from '@archibim/core-engine';
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
  ParapetMesh,
  GutterMesh,
  SkylightMesh,
} from './Live3DView';

export interface BuildingSectionViewProps {
  floors: Floor[];
  floorElements: Record<string, FloorElements>;
  sectionLine: SectionLine;
  height?: number;
  /** Shows a datum line + label at each floor's base height, spanning
   * the width of the cut itself — the "Levels" annotation, same as in
   * BuildingElevationView. Defaults to on. */
  showLevels?: boolean;
  /** Phase B — Scale-accurate sheet export: same zoom-aware canvas
   * bridge as BuildingElevationView — see its onCanvasReady comment for
   * why this reports metersPerPixel alongside the canvas, and why it's
   * throttled to real changes rather than firing every frame. */
  onCanvasReady?: (canvas: HTMLCanvasElement, metersPerPixel: number) => void;
  /** Phase A — Elevation/Render material fidelity: same resolved-material
   * source as the other three views. Optional/defaults to empty. */
  libraryItems?: LibraryItem[];
}

/** See the identical bridge in BuildingElevationView.tsx for why
 * dividing by gl.getPixelRatio() is required here — in short, `1/zoom`
 * is world-units per CSS pixel, but sheet-export.ts needs world-units
 * per BACKING-buffer pixel (canvasEl.width/height, what toDataURL()
 * actually captures), which differ by exactly the renderer's pixel
 * ratio on any screen with devicePixelRatio > 1. */
function CanvasRefBridge({ onReady }: { onReady?: (canvas: HTMLCanvasElement, metersPerPixel: number) => void }) {
  const { gl, camera } = useThree();
  const lastReported = useRef<number | null>(null);
  useFrame(() => {
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
    const pixelRatio = gl.getPixelRatio() || 1;
    const metersPerPixel = 1 / zoom / pixelRatio;
    if (lastReported.current === null || Math.abs(lastReported.current - metersPerPixel) > 1e-6) {
      lastReported.current = metersPerPixel;
      onReady?.(gl.domElement, metersPerPixel);
    }
  });
  return null;
}

/** Applies a global Three.js clipping plane to the renderer — every
 * material in the scene respects it automatically, so nothing needs to
 * be touched per-mesh. This is what actually "cuts" the building open;
 * everything between the camera and the section line is clipped away,
 * revealing the interior on the kept side. */
function GlobalClippingPlane({ plane }: { plane: THREE.Plane }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
    gl.clippingPlanes = [plane];
    return () => {
      gl.clippingPlanes = [];
    };
  }, [gl, plane]);
  return null;
}

/**
 * A Section is the same "stack every floor, view orthographically"
 * approach as BuildingElevationView, plus one addition: a clipping plane
 * defined by the SectionLine, so instead of viewing the building from
 * outside, the camera looks through a vertical cut and everything in
 * front of it (between the camera and the cut) disappears — revealing
 * the interior the way a real architectural section does.
 */
export function BuildingSectionView({
  floors,
  floorElements,
  sectionLine,
  height = 600,
  showLevels = true,
  onCanvasReady,
  libraryItems = [],
}: BuildingSectionViewProps) {
  const baseElevations = useMemo(() => computeFloorBaseElevations(floors), [floors]);
  const materialLookup = useMemo(() => buildMaterialLookup(libraryItems), [libraryItems]);

  // Audit Gap Closure Phase 4 — resolves the actual Stair/Wall document
  // this detail section targets, plus which floor's base elevation it
  // sits on (needed to convert the stair's floor-relative rise into a
  // world-space Y for both camera framing and the riser/tread labels).
  // Undefined whenever sectionLine has no detailTarget, or the target
  // element/floor can no longer be found (e.g. it was deleted after the
  // SectionLine was drawn through it) — callers below treat that as "no
  // detail framing", falling back to the ordinary whole-building camera
  // exactly as if detailTarget had never been set, rather than crashing
  // the section render over one stale reference.
  const detail = useMemo(() => {
    if (!sectionLine.detailTarget) return null;
    const floor = floors.find((f) => f.id === sectionLine.floorId);
    if (!floor) return null;
    const elements = floorElements[floor.id];
    if (!elements) return null;
    const base = baseElevations.get(floor.id) ?? 0;
    if (sectionLine.detailTarget.kind === 'stair') {
      const stair = elements.stairs.find((s) => s.id === sectionLine.detailTarget!.elementId);
      if (!stair) return null;
      const ref = stairReferencePoint(stair);
      const totalRise = (stair.flights ?? []).reduce((sum, f) => sum + f.numberOfSteps * f.riserHeight, 0);
      return { kind: 'stair' as const, stair, floor, base, ref, totalRise };
    }
    if (sectionLine.detailTarget.kind === 'wall') {
      const wall = elements.walls.find((w) => w.id === sectionLine.detailTarget!.elementId);
      if (!wall) return null;
      return { kind: 'wall' as const, wall, floor, base };
    }
    // Audit Gap Closure Phase 6 (items 22-23-25) — Balcony/Railing/
    // Parapet detail targets, same "look up the live document, don't
    // duplicate its geometry" reasoning as stair/wall above.
    if (sectionLine.detailTarget.kind === 'balcony') {
      const balcony = elements.balconies.find((b) => b.id === sectionLine.detailTarget!.elementId);
      if (!balcony) return null;
      const xs = balcony.boundary.map((p) => p.x);
      const ys = balcony.boundary.map((p) => p.y);
      const center = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
      return { kind: 'balcony' as const, balcony, floor, base, center };
    }
    if (sectionLine.detailTarget.kind === 'railing') {
      const railing = elements.railings.find((r) => r.id === sectionLine.detailTarget!.elementId);
      if (!railing) return null;
      return { kind: 'railing' as const, railing, floor, base };
    }
    if (sectionLine.detailTarget.kind === 'parapet') {
      const parapet = elements.parapets.find((p) => p.id === sectionLine.detailTarget!.elementId);
      if (!parapet) return null;
      return { kind: 'parapet' as const, parapet, floor, base };
    }
    // Audit Gap Closure Phase 6 (item 18) — Door & Window Details. An
    // Opening has no world position of its own — positionOnWall is
    // parametric along whichever Wall it's cut into — so this resolves
    // the owning Wall too and computes the real point with the exact
    // same pointAtParameter helper the wall-joinery code already uses,
    // rather than approximating it here a second way.
    const opening = elements.openings.find((o) => o.id === sectionLine.detailTarget!.elementId);
    if (!opening) return null;
    const wall = elements.walls.find((w) => w.id === opening.wallId);
    if (!wall) return null;
    const ref = pointAtParameter(wall, opening.positionOnWall);
    return { kind: 'opening' as const, opening, wall, floor, base, ref };
  }, [sectionLine, floors, floorElements, baseElevations]);

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

  const { plane, cameraPosition, target, zoom, far } = useMemo(() => {
    const dx = sectionLine.end.x - sectionLine.start.x;
    const dy = sectionLine.end.y - sectionLine.start.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len;
    const uy = dy / len;
    // Kept-region normal — matches the left-normal convention used for
    // the section-arrow rendering in FloorPlanCanvas's 2D view.
    const keptNormal =
      sectionLine.viewDirection === 'left' ? { x: -uy, y: ux } : { x: uy, y: -ux };
    const mid = {
      x: (sectionLine.start.x + sectionLine.end.x) / 2,
      y: (sectionLine.start.y + sectionLine.end.y) / 2,
    };

    const planePoint = new THREE.Vector3(sectionLine.start.x, 0, sectionLine.start.y);
    const planeNormal = new THREE.Vector3(keptNormal.x, 0, keptNormal.y).normalize();
    const cutPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);

    // Audit Gap Closure Phase 4 — a detail target overrides the vertical
    // center/zoom/far-plane with a tight frame around just that element
    // (a stair's total rise, or a generous fixed band around a wall's
    // height), instead of the whole-building framing below. The
    // clip-plane and horizontal camera position stay identical to the
    // whole-building case — a detail section is still cut from the same
    // line, just viewed up close.
    if (detail) {
      const detailBase = detail.base;
      // Audit Gap Closure Phase 6 (item 18) — an Opening's vertical
      // extent starts at sillHeight above the floor, not at floor level
      // like every other detail kind here — this offset shifts the
      // framed band up to match, so a Door & Window Details camera
      // centers on the actual door/window leaf rather than half on the
      // wall below the sill.
      const detailBaseOffset = detail.kind === 'opening' ? detail.opening.sillHeight : 0;
      // Audit Gap Closure Phase 6 (items 22-23-25) — Balcony/Railing/
      // Parapet each contribute their own real height/thickness to frame
      // around, same reasoning as stair/wall above.
      const detailHeight =
        detail.kind === 'stair'
          ? Math.max(detail.totalRise, 1)
          : detail.kind === 'wall'
            ? Math.max(detail.wall.height, 1)
            : detail.kind === 'balcony'
              ? Math.max(detail.balcony.thickness * 4, 1) // a balcony slab is thin — a fixed generous band frames the edge detail rather than a nearly-invisible sliver
              : detail.kind === 'railing'
                ? Math.max(detail.railing.height, 1)
                : detail.kind === 'parapet'
                  ? Math.max(detail.parapet.height, 1)
                  : Math.max(detail.opening.height, 1);
      const detailMidY = detailBase + detailBaseOffset + detailHeight / 2;
      const detailFar = Math.max(bounds.spanX, bounds.spanZ, detailHeight) * 4 + 50;
      const camPos: [number, number, number] = [
        mid.x - keptNormal.x * detailFar,
        detailMidY,
        mid.y - keptNormal.y * detailFar,
      ];
      return {
        plane: cutPlane,
        cameraPosition: camPos,
        target: [mid.x, detailMidY, mid.y] as [number, number, number],
        // Tighter zoom than the whole-building formula below — a detail
        // sheet wants the target element filling most of the frame, not
        // a slice of a much taller building.
        zoom: Math.max(20, Math.min(160, 260 / Math.max(detailHeight * 1.3, 1))),
        far: detailFar,
      };
    }

    const farDist = Math.max(bounds.spanX, bounds.spanZ, bounds.maxTop) * 4 + 50;
    const midY = bounds.maxTop / 2;

    const camPos: [number, number, number] = [
      mid.x - keptNormal.x * farDist,
      midY,
      mid.y - keptNormal.y * farDist,
    ];

    return {
      plane: cutPlane,
      cameraPosition: camPos,
      target: [mid.x, midY, mid.y] as [number, number, number],
      zoom: Math.max(10, Math.min(80, 500 / Math.max(len, bounds.maxTop * 1.5, 1))),
      far: farDist,
    };
  }, [sectionLine, bounds, detail]);

  // Phase C — Sheet annotation: grid bubbles for a section cut. The cut
  // can run at any angle (unlike an Elevation, which is always locked to
  // one of the 4 cardinal directions), so "which grid axis is relevant"
  // isn't a fixed N/S vs E/W choice here — it's whichever orientation
  // (vertical/horizontal) runs more parallel to the cut line itself,
  // since that's the axis whose lines the cut actually crosses at
  // meaningfully different points along its length. A grid line's
  // world position is then projected onto the cut's own direction
  // vector to get its left-right placement in this particular view.
  const relevantGridLines = useMemo(() => {
    const dx = sectionLine.end.x - sectionLine.start.x;
    const dy = sectionLine.end.y - sectionLine.start.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len;
    const uy = dy / len;
    // A "vertical" GridLine (constant x) is crossed at a distinctly
    // different point per line when the cut runs mostly along X — i.e.
    // |ux| is large — so that's the orientation to show in that case.
    const wantOrientation = Math.abs(ux) >= Math.abs(uy) ? 'vertical' : 'horizontal';
    const mid = {
      x: (sectionLine.start.x + sectionLine.end.x) / 2,
      y: (sectionLine.start.y + sectionLine.end.y) / 2,
    };
    const seen = new Map<number, { lateral: number; label: string }>();
    for (const floor of floors) {
      const lines = floorElements[floor.id]?.gridLines ?? [];
      const sameOrientation = lines.filter((l) => l.orientation === wantOrientation);
      sameOrientation.forEach((line, index) => {
        const key = Math.round(line.position * 1000);
        if (seen.has(key)) return;
        const label = line.label ?? (wantOrientation === 'vertical' ? String(index + 1) : numberToLetters(index));
        // Project this grid line's world position onto the cut's own
        // direction vector, relative to the cut's midpoint — gives a
        // signed lateral offset usable as a param along `start..end`.
        const worldPoint = wantOrientation === 'vertical' ? { x: line.position, y: mid.y } : { x: mid.x, y: line.position };
        const lateral = (worldPoint.x - mid.x) * ux + (worldPoint.y - mid.y) * uy;
        seen.set(key, { lateral, label });
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.lateral - b.lateral);
  }, [floors, floorElements, sectionLine]);

  return (
    <div style={{ height }} className="overflow-hidden rounded-sheet border border-line bg-[#F6F7F9]">
      <Canvas
        gl={{ localClippingEnabled: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.5]}
      >
        <CanvasRefBridge onReady={onCanvasReady} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[15, 20, 10]} intensity={0.6} />
        <OrthographicCamera makeDefault position={cameraPosition} zoom={zoom} near={0.1} far={far * 2} />
        <GlobalClippingPlane plane={plane} />

        {floors.map((floor) => {
          const elements = floorElements[floor.id];
          if (!elements) return null;
          const base = baseElevations.get(floor.id) ?? 0;
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
                const material = resolveMaterial(wall, materialLookup, '#E7E9EE');
                return (
                  <WallMesh
                    key={wall.id}
                    wall={wall}
                    segment={wall}
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
              {elements.parapets.map((p) => (
                <ParapetMesh key={p.id} parapet={p} selected={false} />
              ))}
              {elements.gutters.map((g) => (
                <GutterMesh key={g.id} gutter={g} selected={false} />
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
          // Reconstruct the world point for this lateral offset along the
          // cut's own direction vector, then place the bubble at
          // building-top height directly above that point — same idea as
          // BuildingElevationView's grid bubbles, just parameterized by
          // the cut's arbitrary direction instead of a fixed cardinal axis.
          const dx = sectionLine.end.x - sectionLine.start.x;
          const dy = sectionLine.end.y - sectionLine.start.y;
          const len = Math.hypot(dx, dy) || 1e-6;
          const ux = dx / len;
          const uy = dy / len;
          const mid = {
            x: (sectionLine.start.x + sectionLine.end.x) / 2,
            y: (sectionLine.start.y + sectionLine.end.y) / 2,
          };
          const worldX = mid.x + ux * line.lateral;
          const worldZ = mid.y + uy * line.lateral;
          const bubbleTop = bounds.maxTop + 1.2;
          const start: [number, number, number] = [worldX, 0, worldZ];
          const end: [number, number, number] = [worldX, bubbleTop, worldZ];
          return (
            <group key={`grid-${line.label}`}>
              <Line points={[start, end]} color="#9AA3B2" lineWidth={1} dashed dashSize={0.25} gapSize={0.15} />
              <Html position={end} center occlude={false}>
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
            const a: [number, number, number] = [sectionLine.start.x, base, sectionLine.start.y];
            const b: [number, number, number] = [sectionLine.end.x, base, sectionLine.end.y];
            return (
              <group key={`level-${floor.id}`}>
                <Line points={[a, b]} color="#7A8599" lineWidth={1} dashed dashSize={0.3} gapSize={0.2} />
                <Html position={b} center={false} occlude={false}>
                  <div className="pointer-events-none flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-muted bg-white font-mono text-[9px] font-semibold text-ink shadow-sm">
                      {floorIndex + 1}
                    </div>
                    <div className="rounded bg-white/85 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted shadow-sm">
                      {floor.name} {base >= 0 ? '+' : '-'}
                      {formatFeetInches(Math.abs(base))}
                    </div>
                  </div>
                </Html>
              </group>
            );
          })}

        {detail && detail.kind === 'stair' && (
          <group key="stair-detail-dims">
            {(() => {
              // Audit Gap Closure Phase 4 (item 13) — one riser/tread
              // label per flight, stacked along the section cut so each
              // label sits roughly where that flight's steps actually
              // are, rather than one summary number for the whole stair
              // (a real stair detail dimensions each flight, since
              // flights can have different riser heights).
              let runningRise = 0;
              return detail.stair.flights.map((flight, i) => {
                const flightRise = flight.numberOfSteps * flight.riserHeight;
                const labelY = detail.base + runningRise + flightRise / 2;
                runningRise += flightRise;
                const tread = treadDepth(flight);
                const labelPos: [number, number, number] = [detail.ref.x, labelY, detail.ref.y];
                return (
                  <Html key={`flight-${i}`} position={labelPos} center={false} occlude={false}>
                    <div className="pointer-events-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#C4692C] shadow-sm">
                      {flight.numberOfSteps} R @ {Math.round(flight.riserHeight * 1000)}mm / T {Math.round(tread * 1000)}mm
                    </div>
                  </Html>
                );
              });
            })()}
            <Html position={[detail.ref.x, detail.base + detail.totalRise + 0.3, detail.ref.y]} center={false} occlude={false}>
              <div className="pointer-events-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4692C] shadow-sm">
                Total rise {formatFeetInches(detail.totalRise)}
              </div>
            </Html>
          </group>
        )}

        {detail && detail.kind === 'wall' && (
          <group key="wall-detail-dims">
            <Html
              position={[
                (detail.wall.start.x + detail.wall.end.x) / 2,
                detail.base + detail.wall.height + 0.3,
                (detail.wall.start.y + detail.wall.end.y) / 2,
              ]}
              center={false}
              occlude={false}
            >
              <div className="pointer-events-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4692C] shadow-sm">
                {detail.wall.type} wall — {Math.round(detail.wall.thickness * 1000)}mm thick, {formatFeetInches(detail.wall.height)} high
                {detail.wall.fireRatingMinutes ? ` · ${detail.wall.fireRatingMinutes}min fire rating` : ''}
              </div>
            </Html>
          </group>
        )}

        {detail && detail.kind === 'balcony' && (
          <group key="balcony-detail-dims">
            <Html
              position={[detail.center.x, detail.base + detail.balcony.thickness + 0.3, detail.center.y]}
              center={false}
              occlude={false}
            >
              <div className="pointer-events-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4692C] shadow-sm">
                Balcony slab — {Math.round(detail.balcony.thickness * 1000)}mm thick
              </div>
            </Html>
          </group>
        )}

        {detail && detail.kind === 'railing' && (
          <group key="railing-detail-dims">
            <Html
              position={[
                (detail.railing.start.x + detail.railing.end.x) / 2,
                detail.base + detail.railing.height + 0.3,
                (detail.railing.start.y + detail.railing.end.y) / 2,
              ]}
              center={false}
              occlude={false}
            >
              <div className="pointer-events-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4692C] shadow-sm">
                Railing — {formatFeetInches(detail.railing.height)} high, {Math.round(detail.railing.postSpacing * 1000)}mm post spacing
              </div>
            </Html>
          </group>
        )}

        {detail && detail.kind === 'parapet' && (
          <group key="parapet-detail-dims">
            <Html
              position={[
                (detail.parapet.start.x + detail.parapet.end.x) / 2,
                detail.base + detail.parapet.height + 0.3,
                (detail.parapet.start.y + detail.parapet.end.y) / 2,
              ]}
              center={false}
              occlude={false}
            >
              <div className="pointer-events-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4692C] shadow-sm">
                Parapet — {formatFeetInches(detail.parapet.height)} high, {Math.round(detail.parapet.thickness * 1000)}mm thick
              </div>
            </Html>
          </group>
        )}

        {detail && detail.kind === 'opening' && (
          <group key="opening-detail-dims">
            <Html
              position={[detail.ref.x, detail.base + detail.opening.sillHeight + detail.opening.height + 0.3, detail.ref.y]}
              center={false}
              occlude={false}
            >
              <div className="pointer-events-none whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4692C] shadow-sm">
                {detail.opening.kind === 'DOOR' ? 'Door' : 'Window'}
                {detail.opening.tag ? ` ${detail.opening.tag}` : ''} — {Math.round(detail.opening.width * 1000)}mm ×{' '}
                {Math.round(detail.opening.height * 1000)}mm
                {detail.opening.kind === 'WINDOW' ? `, sill ${Math.round(detail.opening.sillHeight * 1000)}mm` : ''}
              </div>
            </Html>
          </group>
        )}

        <OrbitControls target={target} enableRotate={false} makeDefault />
      </Canvas>
    </div>
  );
}
