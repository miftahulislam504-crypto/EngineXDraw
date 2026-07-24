'use client';

import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Html, Line } from '@react-three/drei';
import type { Floor } from '@archibim/object-model';
import { computeFloorBaseElevations } from '@archibim/core-engine';
import type { FloorElements } from '@/lib/floors';
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
  /** Shows a horizontal datum line + label at each floor's base height —
   * the "Levels" annotation, derived live from Floor data (no separate
   * placed object, same idea as Room Tags reusing Room data). Defaults
   * to on since it's genuinely useful reference info, not clutter. */
  showLevels?: boolean;
  /** Fires once the underlying WebGL canvas element is available — used
   * by the Sheet export flow to capture this view as an image. Needs the
   * renderer's preserveDrawingBuffer (set below) or the capture would
   * come back blank; that's a well-known Three.js/WebGL screenshot
   * gotcha, not optional here. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

function CanvasRefBridge({ onReady }: { onReady?: (canvas: HTMLCanvasElement) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    onReady?.(gl.domElement);
  }, [gl, onReady]);
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
}: BuildingElevationViewProps) {
  const baseElevations = useMemo(() => computeFloorBaseElevations(floors), [floors]);

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
                return <WallMesh key={wall.id} wall={wall} segment={segment} selected={false} />;
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
              {elements.roofs.map((r) => (
                <PlanarBoxMesh
                  key={r.id}
                  boundary={r.boundary}
                  thickness={r.thickness}
                  elevation={r.elevation}
                  color="#8B5E4A"
                  selectedColor="#8B5E4A"
                  selected={false}
                />
              ))}
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

        {showLevels &&
          floors.map((floor) => {
            const base = baseElevations.get(floor.id) ?? 0;
            const a: [number, number, number] = [levelA[0], base, levelA[2]];
            const b: [number, number, number] = [levelB[0], base, levelB[2]];
            const labelPos: [number, number, number] = [b[0], base, b[2]];
            return (
              <group key={`level-${floor.id}`}>
                <Line points={[a, b]} color="#7A8599" lineWidth={1} dashed dashSize={0.3} gapSize={0.2} />
                <Html position={labelPos} center={false} occlude={false}>
                  <div className="pointer-events-none whitespace-nowrap rounded bg-white/85 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted shadow-sm">
                    {floor.name} {base >= 0 ? '+' : ''}
                    {base.toFixed(2)}m
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
