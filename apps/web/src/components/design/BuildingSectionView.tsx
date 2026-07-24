'use client';

import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Floor, SectionLine } from '@archibim/object-model';
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

export interface BuildingSectionViewProps {
  floors: Floor[];
  floorElements: Record<string, FloorElements>;
  sectionLine: SectionLine;
  height?: number;
  /** Shows a datum line + label at each floor's base height, spanning
   * the width of the cut itself — the "Levels" annotation, same as in
   * BuildingElevationView. Defaults to on. */
  showLevels?: boolean;
  /** Same canvas-capture bridge as BuildingElevationView — see its
   * comment for why preserveDrawingBuffer matters here. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

function CanvasRefBridge({ onReady }: { onReady?: (canvas: HTMLCanvasElement) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    onReady?.(gl.domElement);
  }, [gl, onReady]);
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
}: BuildingSectionViewProps) {
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
              {elements.walls.map((wall) => (
                <WallMesh key={wall.id} wall={wall} segment={wall} selected={false} />
              ))}
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
            const a: [number, number, number] = [sectionLine.start.x, base, sectionLine.start.y];
            const b: [number, number, number] = [sectionLine.end.x, base, sectionLine.end.y];
            return (
              <group key={`level-${floor.id}`}>
                <Line points={[a, b]} color="#7A8599" lineWidth={1} dashed dashSize={0.3} gapSize={0.2} />
                <Html position={b} center={false} occlude={false}>
                  <div className="pointer-events-none whitespace-nowrap rounded bg-white/85 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted shadow-sm">
                    {floor.name} {base >= 0 ? '+' : ''}
                    {base.toFixed(2)}m
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
