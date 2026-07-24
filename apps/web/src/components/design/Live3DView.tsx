'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Html } from '@react-three/drei';
import type {
  Balcony,
  Beam,
  Ceiling,
  Column,
  CurtainWall,
  Footing,
  Foundation,
  Opening,
  PlacedObject,
  Railing,
  Ramp,
  Roof,
  Room,
  Skylight,
  Slab,
  Stair,
  Wall,
} from '@archibim/object-model';
import { pointAtParameter, computeExtendedWallSegments } from '@archibim/core-engine';

export interface Live3DViewProps {
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  ceilings: Ceiling[];
  foundations: Foundation[];
  footings: Footing[];
  roofs: Roof[];
  ramps: Ramp[];
  railings: Railing[];
  stairs: Stair[];
  balconies: Balcony[];
  curtainWalls: CurtainWall[];
  skylights: Skylight[];
  placedObjects: PlacedObject[];
  rooms: Room[];
  explodedView?: boolean;
  height?: number;
}

/** Exploded view offsets everything above ground floor upward, per-floor —
 * this MVP only has one floor's worth of elements at a time, so it lifts
 * every element by a fixed gap purely to show the concept; a true
 * per-floor explode needs the design studio to load multiple floors at
 * once, which is a page-level change beyond this component. */
const EXPLODE_LIFT = 1.5;

export function WallMesh({ wall, segment, selected, colorOverride }: {
  wall: Wall;
  segment: { start: typeof wall.start; end: typeof wall.end };
  selected: boolean;
  /** Phase 8 — Visualization: optional Material Preview theme override for
   * the unselected color. Selected state always wins (still shows the
   * selection-blue highlight) — this only swaps the "normal" appearance. */
  colorOverride?: string;
}) {
  const dx = segment.end.x - segment.start.x;
  const dz = segment.end.y - segment.start.y;
  const angle = Math.atan2(dz, dx);
  const length = Math.hypot(dx, dz);
  const center = {
    x: (segment.start.x + segment.end.x) / 2,
    z: (segment.start.y + segment.end.y) / 2,
  };

  return (
    <mesh position={[center.x, wall.height / 2, center.z]} rotation={[0, -angle, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, wall.height, wall.thickness]} />
      <meshStandardMaterial color={selected ? '#2D6CDF' : (colorOverride ?? '#E7E9EE')} />
    </mesh>
  );
}

/**
 * True boolean subtraction (actually cutting the opening out of the wall
 * mesh) needs a CSG library — still deferred. This renders a marker plane
 * on the wall face at the opening's position.
 */
export function OpeningMarker({ opening, wall }: { opening: Opening; wall: Wall }) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const angle = Math.atan2(dz, dx);
  const center2D = pointAtParameter(wall, opening.positionOnWall);
  const isDoor = opening.kind === 'DOOR';
  const sill = isDoor ? 0 : opening.sillHeight;

  return (
    <mesh position={[center2D.x, sill + opening.height / 2, center2D.y]} rotation={[0, -angle, 0]}>
      <planeGeometry args={[opening.width, opening.height]} />
      <meshStandardMaterial color={isDoor ? '#E8871E' : '#2D6CDF'} transparent opacity={0.55} side={2} />
    </mesh>
  );
}

export function ColumnMesh({ column, selected, colorOverride }: { column: Column; selected: boolean; colorOverride?: string }) {
  const color = selected ? '#2D6CDF' : (colorOverride ?? '#8B93A7');
  return (
    <mesh position={[column.center.x, column.height / 2, column.center.y]} castShadow receiveShadow>
      {column.shape === 'CIRCULAR' ? (
        <cylinderGeometry args={[column.width / 2, column.width / 2, column.height, 24]} />
      ) : (
        <boxGeometry args={[column.width, column.height, column.depth]} />
      )}
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

export function BeamMesh({ beam, selected, colorOverride }: { beam: Beam; selected: boolean; colorOverride?: string }) {
  const dx = beam.end.x - beam.start.x;
  const dz = beam.end.y - beam.start.y;
  const angle = Math.atan2(dz, dx);
  const length = Math.hypot(dx, dz);
  const center = { x: (beam.start.x + beam.end.x) / 2, z: (beam.start.y + beam.end.y) / 2 };
  const centerY = beam.elevation + beam.depth / 2;

  return (
    <mesh position={[center.x, centerY, center.z]} rotation={[0, -angle, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, beam.depth, beam.width]} />
      <meshStandardMaterial color={selected ? '#2D6CDF' : (colorOverride ?? '#B7C0D1')} />
    </mesh>
  );
}

/** Shared by Slab, Ceiling, Foundation, Roof — all four are geometrically
 * "a horizontal box spanning a plan boundary", just at different roles/
 * elevations/default colors. Axis-aligned bounding box, same simplification
 * as before (matches what the 2-click rectangle tool actually creates). */
export function PlanarBoxMesh({
  boundary,
  thickness,
  elevation,
  color,
  selectedColor,
  selected,
}: {
  boundary: { x: number; y: number }[];
  thickness: number;
  elevation: number;
  color: string;
  selectedColor: string;
  selected: boolean;
}) {
  const xs = boundary.map((p) => p.x);
  const zs = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = Math.max(0.05, maxX - minX);
  const depth = Math.max(0.05, maxZ - minZ);
  const centerY = elevation + thickness / 2;

  return (
    <mesh position={[(minX + maxX) / 2, centerY, (minZ + maxZ) / 2]} receiveShadow castShadow>
      <boxGeometry args={[width, thickness, depth]} />
      <meshStandardMaterial color={selected ? selectedColor : color} />
    </mesh>
  );
}

export function FootingMesh({ footing, selected, colorOverride }: { footing: Footing; selected: boolean; colorOverride?: string }) {
  const centerY = footing.elevation + footing.thickness / 2;
  return (
    <mesh position={[footing.center.x, centerY, footing.center.y]} receiveShadow castShadow>
      <boxGeometry args={[footing.width, footing.thickness, footing.depth]} />
      <meshStandardMaterial color={selected ? '#2D6CDF' : (colorOverride ?? '#6B7280')} />
    </mesh>
  );
}

/** A ramp genuinely *is* a rotated rectangular plane, so this rotation is
 * the correct geometry, not an approximation (unlike the roof situation). */
export function RampMesh({ ramp, selected, colorOverride }: { ramp: Ramp; selected: boolean; colorOverride?: string }) {
  const dx = ramp.end.x - ramp.start.x;
  const dz = ramp.end.y - ramp.start.y;
  const horizontalLength = Math.hypot(dx, dz);
  const rise = ramp.endElevation - ramp.startElevation;
  const slopeLength = Math.hypot(horizontalLength, rise);
  const yaw = Math.atan2(dz, dx);
  const pitch = Math.atan2(rise, horizontalLength);
  const center = {
    x: (ramp.start.x + ramp.end.x) / 2,
    y: (ramp.startElevation + ramp.endElevation) / 2,
    z: (ramp.start.y + ramp.end.y) / 2,
  };

  return (
    <group position={[center.x, center.y, center.z]} rotation={[0, -yaw, 0]}>
      {/* Second rotation (pitch) applied via a nested group so yaw and pitch
          compose predictably instead of fighting over the same axis. */}
      <group rotation={[0, 0, pitch]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[slopeLength, ramp.thickness, ramp.width]} />
          <meshStandardMaterial color={selected ? '#2D6CDF' : (colorOverride ?? '#C7CCD6')} />
        </mesh>
      </group>
    </group>
  );
}

export function RailingMesh({ railing, selected, colorOverride }: { railing: Railing; selected: boolean; colorOverride?: string }) {
  const dx = railing.end.x - railing.start.x;
  const dz = railing.end.y - railing.start.y;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const postCount = Math.max(2, Math.floor(length / railing.postSpacing) + 1);
  const color = selected ? '#2D6CDF' : (colorOverride ?? '#8B93A7');
  const postSize = 0.05;
  const railSize = 0.05;

  return (
    <group position={[railing.start.x, 0, railing.start.y]} rotation={[0, -angle, 0]}>
      {Array.from({ length: postCount }).map((_, i) => {
        const t = postCount === 1 ? 0 : (i / (postCount - 1)) * length;
        return (
          <mesh key={i} position={[t, railing.height / 2, 0]} castShadow>
            <boxGeometry args={[postSize, railing.height, postSize]} />
            <meshStandardMaterial color={color} />
          </mesh>
        );
      })}
      <mesh position={[length / 2, railing.height, 0]} castShadow>
        <boxGeometry args={[length, railSize, railSize]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Stacked boxes, each both taller and longer than the last — the standard
 * low-risk way to render a staircase silhouette without a custom
 * per-vertex profile mesh. */
export function StairMesh({ stair, selected, colorOverride }: { stair: Stair; selected: boolean; colorOverride?: string }) {
  const dx = stair.end.x - stair.start.x;
  const dz = stair.end.y - stair.start.y;
  const totalRun = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const treadDepth = totalRun / stair.numberOfSteps;
  const color = selected ? '#2D6CDF' : (colorOverride ?? '#B7C0D1');

  return (
    <group position={[stair.start.x, 0, stair.start.y]} rotation={[0, -angle, 0]}>
      {Array.from({ length: stair.numberOfSteps }).map((_, i) => {
        const stepRun = (i + 1) * treadDepth;
        const stepRise = (i + 1) * stair.riserHeight;
        return (
          <mesh key={i} position={[stepRun / 2, stepRise / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[stepRun, stepRise, stair.width]} />
            <meshStandardMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Glazed wall with a simple vertical-mullion grid — visually distinct from
 * a solid Wall via a transparent glass material plus thin opaque mullion
 * strips at regular intervals. */
export function CurtainWallMesh({ curtainWall, selected, glassColorOverride }: { curtainWall: CurtainWall; selected: boolean; glassColorOverride?: string }) {
  const dx = curtainWall.end.x - curtainWall.start.x;
  const dz = curtainWall.end.y - curtainWall.start.y;
  const angle = Math.atan2(dz, dx);
  const length = Math.hypot(dx, dz);
  const center = {
    x: (curtainWall.start.x + curtainWall.end.x) / 2,
    z: (curtainWall.start.y + curtainWall.end.y) / 2,
  };
  const mullionCount = Math.max(0, Math.floor(length / curtainWall.mullionSpacing) - 1);

  return (
    <group position={[center.x, 0, center.z]} rotation={[0, -angle, 0]}>
      <mesh position={[0, curtainWall.height / 2, 0]}>
        <boxGeometry args={[length, curtainWall.height, curtainWall.thickness]} />
        <meshStandardMaterial
          color={selected ? '#2D6CDF' : (glassColorOverride ?? '#BFE0F2')}
          transparent
          opacity={0.35}
        />
      </mesh>
      {Array.from({ length: mullionCount }).map((_, i) => {
        const t = ((i + 1) / (mullionCount + 1) - 0.5) * length;
        return (
          <mesh key={i} position={[t, curtainWall.height / 2, 0]} castShadow>
            <boxGeometry args={[0.06, curtainWall.height, curtainWall.thickness * 1.4]} />
            <meshStandardMaterial color={selected ? '#2D6CDF' : '#8B93A7'} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Marker plane over a roof opening — same simplification as door/window
 * openings (no true cutout in the roof mesh underneath). topElevation is
 * the roof's top face height (elevation + thickness), passed in by the
 * caller since that's where the matching Roof is looked up. */
export function SkylightMesh({ skylight, topElevation, colorOverride }: { skylight: Skylight; topElevation: number; colorOverride?: string }) {
  return (
    <mesh
      position={[skylight.center.x, topElevation + 0.01, skylight.center.y]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[skylight.width, skylight.depth]} />
      <meshStandardMaterial color={colorOverride ?? '#BFE0F2'} transparent opacity={0.6} side={2} />
    </mesh>
  );
}

/** Floor-level room name + area label, using drei's Html (an ordinary
 * positioned DOM element) rather than in-canvas Text — avoids needing a
 * font loaded into the WebGL context for something this simple. */
export function RoomLabel({ room }: { room: Room }) {
  return (
    <Html position={[room.centroid.x, 0.05, room.centroid.y]} center distanceFactor={12} occlude>
      <div className="pointer-events-none whitespace-nowrap rounded bg-white/80 px-2 py-0.5 text-center font-mono text-[10px] text-ink-muted shadow-sm">
        {room.name}
        <br />
        {room.areaSqm.toFixed(1)} m²
      </div>
    </Html>
  );
}

export function PlacedObjectMesh({ object, selected }: { object: PlacedObject; selected: boolean }) {
  const colors: Record<PlacedObject['category'], string> = {
    FURNITURE: '#8B93A7',
    KITCHEN: '#E8871E',
    BATHROOM: '#2D6CDF',
    PARKING: '#1C8A5E',
    LANDSCAPE: '#3F7A4E',
  };
  return (
    <mesh
      position={[object.center.x, object.height / 2, object.center.y]}
      rotation={[0, (-object.rotationDeg * Math.PI) / 180, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[object.width, object.height, object.depth]} />
      <meshStandardMaterial color={selected ? '#2D6CDF' : colors[object.category]} />
    </mesh>
  );
}

export function Live3DView({
  walls,
  openings,
  columns,
  beams,
  slabs,
  ceilings,
  foundations,
  footings,
  roofs,
  ramps,
  railings,
  stairs,
  balconies,
  curtainWalls,
  skylights,
  placedObjects,
  rooms,
  explodedView = false,
  height = 600,
}: Live3DViewProps) {
  const center = useMemo(() => {
    if (walls.length === 0) return { x: 0, z: 0 };
    const sum = walls.reduce(
      (acc, w) => ({ x: acc.x + w.start.x + w.end.x, z: acc.z + w.start.y + w.end.y }),
      { x: 0, z: 0 },
    );
    const n = walls.length * 2;
    return { x: sum.x / n, z: sum.z / n };
  }, [walls]);

  const extendedSegments = useMemo(() => computeExtendedWallSegments(walls), [walls]);
  const lift = explodedView ? EXPLODE_LIFT : 0;

  return (
    <div style={{ height }} className="overflow-hidden rounded-sheet border border-line bg-[#F6F7F9]">
      <Canvas
        shadows
        camera={{ position: [center.x + 10, 10, center.z + 10], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ powerPreference: 'high-performance', antialias: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[15, 20, 10]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <Grid args={[100, 100]} position={[0, 0, 0]} cellColor="#D8DEE9" sectionColor="#B7C0D1" fadeDistance={40} />

        <group position={[0, lift, 0]}>
          {foundations.map((f) => (
            <PlanarBoxMesh
              key={f.id}
              boundary={f.boundary}
              thickness={f.thickness}
              elevation={f.elevation}
              color="#9AA3B2"
              selectedColor="#2D6CDF"
              selected={false}
            />
          ))}
          {footings.map((f) => (
            <FootingMesh key={f.id} footing={f} selected={false} />
          ))}
          {slabs.map((slab) => (
            <PlanarBoxMesh
              key={slab.id}
              boundary={slab.boundary}
              thickness={slab.thickness}
              elevation={slab.elevation}
              color="#D8DEE9"
              selectedColor="#2D6CDF"
              selected={false}
            />
          ))}
          {walls.map((wall) => {
            const segment = extendedSegments.find((s) => s.wallId === wall.id) ?? wall;
            return <WallMesh key={wall.id} wall={wall} segment={segment} selected={false} />;
          })}
          {openings.map((opening) => {
            const wall = walls.find((w) => w.id === opening.wallId);
            return wall ? <OpeningMarker key={opening.id} opening={opening} wall={wall} /> : null;
          })}
          {columns.map((column) => (
            <ColumnMesh key={column.id} column={column} selected={false} />
          ))}
          {beams.map((beam) => (
            <BeamMesh key={beam.id} beam={beam} selected={false} />
          ))}
          {ceilings.map((c) => (
            <PlanarBoxMesh
              key={c.id}
              boundary={c.boundary}
              thickness={c.thickness}
              elevation={c.elevation}
              color="#EDEFF3"
              selectedColor="#2D6CDF"
              selected={false}
            />
          ))}
          {roofs.map((r) => (
            <PlanarBoxMesh
              key={r.id}
              boundary={r.boundary}
              thickness={r.thickness}
              elevation={r.elevation}
              color="#8B5E4A"
              selectedColor="#2D6CDF"
              selected={false}
            />
          ))}
          {ramps.map((r) => (
            <RampMesh key={r.id} ramp={r} selected={false} />
          ))}
          {railings.map((r) => (
            <RailingMesh key={r.id} railing={r} selected={false} />
          ))}
          {stairs.map((s) => (
            <StairMesh key={s.id} stair={s} selected={false} />
          ))}
          {balconies.map((b) => (
            <PlanarBoxMesh
              key={b.id}
              boundary={b.boundary}
              thickness={b.thickness}
              elevation={b.elevation}
              color="#B7C0D1"
              selectedColor="#2D6CDF"
              selected={false}
            />
          ))}
          {curtainWalls.map((cw) => (
            <CurtainWallMesh key={cw.id} curtainWall={cw} selected={false} />
          ))}
          {skylights.map((sky) => {
            const roof = roofs.find((r) => r.id === sky.roofId);
            if (!roof) return null;
            return (
              <SkylightMesh
                key={sky.id}
                skylight={sky}
                topElevation={roof.elevation + roof.thickness}
              />
            );
          })}
          {placedObjects.map((obj) => (
            <PlacedObjectMesh key={obj.id} object={obj} selected={false} />
          ))}
          {rooms.map((room) => (
            <RoomLabel key={room.id} room={room} />
          ))}
        </group>

        <OrbitControls target={[center.x, 1.5, center.z]} makeDefault />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
