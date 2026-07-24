'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import type { Floor, SiteBoundary } from '@archibim/object-model';
import { computeFloorBaseElevations, sunDirectionVector, type SunPosition } from '@archibim/core-engine';
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

export interface BuildingSunStudyViewProps {
  floors: Floor[];
  floorElements: Record<string, FloorElements>;
  siteBoundary?: SiteBoundary | null;
  sun: SunPosition;
  height?: number;
}

/** How far away (world units) the directional light sits along the sun
 * direction vector — far enough that its parallel rays are a good
 * approximation of real sunlight over a building-sized scene. */
const SUN_DISTANCE = 60;
/** Fallback ground-plane half-size (world units) when there's no
 * SiteBoundary to size it from — generous enough for a house-sized
 * building. */
const DEFAULT_GROUND_HALF_SIZE = 30;

/**
 * Every floor of a building, stacked at its real elevation (same
 * computeFloorBaseElevations + reused-mesh-component approach as
 * BuildingElevationView), lit by a directional light placed along the
 * real computed sun direction, with a ground plane that receives
 * shadows — the actual "Shadow Analysis" / "Sunlight Analysis" deliverable.
 *
 * Deliberately excludes Rooms (name/area labels) and PlacedObjects
 * (furniture) — same reasoning as BuildingElevationView: a shadow study
 * is about the building's exterior massing, not its interior contents.
 *
 * When the sun is below the horizon (sun.altitudeDeg <= 0), no
 * directional light is rendered — there is no real sun to cast a shadow
 * from at that moment, so the caller is expected to show a "sun below
 * horizon" message rather than this component fabricating a light.
 */
export function BuildingSunStudyView({ floors, floorElements, siteBoundary, sun, height = 600 }: BuildingSunStudyViewProps) {
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

  const sunDir = useMemo(() => sunDirectionVector(sun), [sun]);
  const lightPosition: [number, number, number] = [
    bounds.centerX + sunDir.x * SUN_DISTANCE,
    sunDir.y * SUN_DISTANCE,
    bounds.centerZ + sunDir.z * SUN_DISTANCE,
  ];
  const hasSun = sun.altitudeDeg > 0;

  return (
    <div style={{ height }} className="overflow-hidden rounded-sheet border border-line bg-[#DCE6F0]">
      <Canvas
        shadows
        camera={{ position: [bounds.centerX + bounds.spanX, bounds.maxTop + bounds.spanX * 0.6, bounds.centerZ + bounds.spanZ], fov: 45 }}
      >
        {/* Dim, sky-toned ambient regardless of sun state — otherwise the
            night-time (sun below horizon) scene would render pure black,
            which reads as broken rather than "it's night". */}
        <ambientLight intensity={hasSun ? 0.5 : 0.15} />
        {hasSun && (
          <directionalLight
            position={lightPosition}
            target-position={[bounds.centerX, 0, bounds.centerZ]}
            intensity={1.3}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-groundHalfSize}
            shadow-camera-right={groundHalfSize}
            shadow-camera-top={groundHalfSize}
            shadow-camera-bottom={-groundHalfSize}
            shadow-camera-near={0.5}
            shadow-camera-far={SUN_DISTANCE * 2}
          />
        )}

        {/* Real ground plane so the building's shadow actually lands on
            something visible — the Grid helper Live3DView uses elsewhere
            is a shader helper, not a shadow-receiving surface. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.centerX, -0.02, bounds.centerZ]} receiveShadow>
          <planeGeometry args={[groundHalfSize * 2, groundHalfSize * 2]} />
          <meshStandardMaterial color="#BFE3B4" />
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

        <OrbitControls target={[bounds.centerX, bounds.maxTop / 2, bounds.centerZ]} makeDefault />
      </Canvas>
    </div>
  );
}
