'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Floor, LibraryItem, SectionLine } from '@archibim/object-model';
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

function CanvasRefBridge({ onReady }: { onReady?: (canvas: HTMLCanvasElement, metersPerPixel: number) => void }) {
  const { gl, camera } = useThree();
  const lastReported = useRef<number | null>(null);
  useFrame(() => {
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
    const metersPerPixel = 1 / zoom;
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

    const farDist = Math.max(bounds.spanX, bounds.spanZ, bounds.maxTop) * 4 + 50;
    const midY = bounds.maxTop / 2;

    const planePoint = new THREE.Vector3(sectionLine.start.x, 0, sectionLine.start.y);
    const planeNormal = new THREE.Vector3(keptNormal.x, 0, keptNormal.y).normalize();
    const cutPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);

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
  }, [sectionLine, bounds]);

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
                      {floor.name} {base >= 0 ? '+' : ''}
                      {base.toFixed(2)}m
                    </div>
                  </div>
                </Html>
              </group>
            );
          })}

        <OrbitControls target={target} enableRotate={false} makeDefault />
      </Canvas>
    </div>
  );
}
