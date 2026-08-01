'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Floor, LibraryItem, SiteBoundary } from '@archibim/object-model';
import { computeFloorBaseElevations, sunDirectionVector } from '@archibim/core-engine';
import type { FloorElements } from '@/lib/floors';
import type { EnvironmentPreset, MaterialTheme } from '@/lib/render-theme';
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

export interface BuildingRenderStudioViewProps {
  floors: Floor[];
  floorElements: Record<string, FloorElements>;
  siteBoundary?: SiteBoundary | null;
  materialTheme: MaterialTheme;
  environmentPreset: EnvironmentPreset;
  qualityMode: 'draft' | 'high';
  autoRotate: boolean;
  height?: number;
  /** Fires once the underlying WebGL canvas element exists, so the page
   * can grab it for canvas.captureStream()-based video recording
   * ("Walkthrough Video") without this component needing to know
   * anything about recording itself. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** Phase A — Elevation/Render material fidelity: same resolved-material
   * source as Live3DView/BuildingElevationView. When a wall/roof has no
   * assigned material this falls back to materialTheme's flat color, so
   * existing projects with no per-element materials set still render
   * exactly as before. */
  libraryItems?: LibraryItem[];
}

/** A fixed, pleasant key-light angle for presentation rendering —
 * reuses the same sun-direction trig as the Environmental Analysis page,
 * but this is NOT tied to any real date/time/location; it's just a
 * flattering fixed "mid-morning, southeast" studio angle, the way any
 * render-preview tool picks a default light rig. For real, astronomically
 * accurate sun position use the Sun & Shadow Study page instead. */
const STUDIO_KEY_LIGHT = { altitudeDeg: 55, azimuthDeg: 135 };
const SUN_DISTANCE = 60;
const DEFAULT_GROUND_HALF_SIZE = 30;

export function BuildingRenderStudioView({
  floors,
  floorElements,
  siteBoundary,
  materialTheme,
  environmentPreset,
  qualityMode,
  autoRotate,
  height = 600,
  onCanvasReady,
  libraryItems = [],
}: BuildingRenderStudioViewProps) {
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
    if (siteBoundary) {
      for (const p of siteBoundary.boundary) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.y);
        maxZ = Math.max(maxZ, p.y);
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
  }, [floors, floorElements, baseElevations, siteBoundary]);

  const groundHalfSize = Math.max(DEFAULT_GROUND_HALF_SIZE, bounds.spanX, bounds.spanZ) * 1.5;

  const sunDir = useMemo(() => sunDirectionVector(STUDIO_KEY_LIGHT), []);
  const lightPosition: [number, number, number] = [
    bounds.centerX + sunDir.x * SUN_DISTANCE,
    sunDir.y * SUN_DISTANCE,
    bounds.centerZ + sunDir.z * SUN_DISTANCE,
  ];

  const shadowMapSize = qualityMode === 'high' ? 2048 : 512;

  return (
    <div style={{ height }} className="overflow-hidden rounded-sheet border border-line bg-[#DCE6F0]">
      <Canvas
        shadows
        dpr={qualityMode === 'high' ? [1, 2] : [1, 1]}
        gl={{ antialias: qualityMode === 'high', toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{ position: [bounds.centerX + bounds.spanX, bounds.maxTop + bounds.spanX * 0.6, bounds.centerZ + bounds.spanZ], fov: 45 }}
        onCreated={(state) => onCanvasReady?.(state.gl.domElement)}
      >
        <ambientLight intensity={0.5} />
        <directionalLight
          position={lightPosition}
          target-position={[bounds.centerX, 0, bounds.centerZ]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={shadowMapSize}
          shadow-mapSize-height={shadowMapSize}
          shadow-camera-left={-groundHalfSize}
          shadow-camera-right={groundHalfSize}
          shadow-camera-top={groundHalfSize}
          shadow-camera-bottom={-groundHalfSize}
          shadow-camera-near={0.5}
          shadow-camera-far={SUN_DISTANCE * 2}
        />

        <Environment preset={environmentPreset} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.centerX, -0.02, bounds.centerZ]} receiveShadow>
          <planeGeometry args={[groundHalfSize * 2, groundHalfSize * 2]} />
          <meshStandardMaterial color={materialTheme.groundColor} />
        </mesh>

        {siteBoundary && (
          <Line
            points={[...siteBoundary.boundary, siteBoundary.boundary[0]].map((p) => [p.x, 0.01, p.y] as [number, number, number])}
            color="#1C8A5E"
            lineWidth={2}
            dashed
            dashSize={0.5}
            gapSize={0.3}
          />
        )}

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
                  color={materialTheme.concreteColor}
                  selectedColor={materialTheme.concreteColor}
                  selected={false}
                />
              ))}
              {elements.footings.map((f) => (
                <FootingMesh key={f.id} footing={f} selected={false} colorOverride={materialTheme.concreteColor} />
              ))}
              {elements.slabs.map((slab) => (
                <PlanarBoxMesh
                  key={slab.id}
                  boundary={slab.boundary}
                  thickness={slab.thickness}
                  elevation={slab.elevation}
                  color={materialTheme.slabColor}
                  selectedColor={materialTheme.slabColor}
                  selected={false}
                />
              ))}
              {elements.walls.map((wall) => {
                const segment = extendedSegments.find((s) => s.wallId === wall.id) ?? wall;
                const material = resolveMaterial(wall, materialLookup, materialTheme.wallColor);
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
                <ColumnMesh key={column.id} column={column} selected={false} colorOverride={materialTheme.concreteColor} />
              ))}
              {elements.beams.map((beam) => (
                <BeamMesh key={beam.id} beam={beam} selected={false} colorOverride={materialTheme.concreteColor} />
              ))}
              {elements.ceilings.map((c) => (
                <PlanarBoxMesh
                  key={c.id}
                  boundary={c.boundary}
                  thickness={c.thickness}
                  elevation={c.elevation}
                  color={materialTheme.ceilingColor}
                  selectedColor={materialTheme.ceilingColor}
                  selected={false}
                />
              ))}
              {elements.roofs.map((r) => {
                const material = resolveMaterial(r, materialLookup, materialTheme.roofColor);
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
                <RampMesh key={r.id} ramp={r} selected={false} colorOverride={materialTheme.concreteColor} />
              ))}
              {elements.railings.map((r) => (
                <RailingMesh key={r.id} railing={r} selected={false} colorOverride={materialTheme.accentColor} />
              ))}
              {elements.stairs.map((s) => (
                <StairMesh key={s.id} stair={s} selected={false} colorOverride={materialTheme.accentColor} />
              ))}
              {elements.balconies.map((b) => (
                <PlanarBoxMesh
                  key={b.id}
                  boundary={b.boundary}
                  thickness={b.thickness}
                  elevation={b.elevation}
                  color={materialTheme.slabColor}
                  selectedColor={materialTheme.slabColor}
                  selected={false}
                />
              ))}
              {elements.curtainWalls.map((cw) => (
                <CurtainWallMesh key={cw.id} curtainWall={cw} selected={false} glassColorOverride={materialTheme.glassColor} />
              ))}
              {elements.skylights.map((sky) => {
                const roof = elements.roofs.find((r) => r.id === sky.roofId);
                if (!roof) return null;
                return (
                  <SkylightMesh
                    key={sky.id}
                    skylight={sky}
                    topElevation={roof.elevation + roof.thickness}
                    colorOverride={materialTheme.glassColor}
                  />
                );
              })}
            </group>
          );
        })}

        <OrbitControls
          target={[bounds.centerX, bounds.maxTop / 2, bounds.centerZ]}
          autoRotate={autoRotate}
          autoRotateSpeed={1.2}
          makeDefault
        />
      </Canvas>
    </div>
  );
}
