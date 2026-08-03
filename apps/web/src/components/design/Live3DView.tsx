'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
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
  LibraryItem,
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
import {
  pointAtParameter,
  computeExtendedWallSegments,
  doorSwingGeometry,
  deriveStairLandings,
} from '@archibim/core-engine';
import { buildMaterialLookup, resolveMaterial } from '@/lib/material-resolver';

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
  /** Phase A — Elevation/Render material fidelity: the MATERIAL-category
   * subset of the shared library, used to resolve each wall/roof's
   * assigned material to an actual render color instead of always
   * showing the flat default. Optional and defaults to empty so existing
   * callers that haven't wired this up yet keep working unchanged. */
  libraryItems?: LibraryItem[];
}

/** Exploded view offsets everything above ground floor upward, per-floor —
 * this MVP only has one floor's worth of elements at a time, so it lifts
 * every element by a fixed gap purely to show the concept; a true
 * per-floor explode needs the design studio to load multiple floors at
 * once, which is a page-level change beyond this component. */
const EXPLODE_LIFT = 1.5;

/** Builds the wall's cross-section as a flat 2D shape (X = distance along
 * the segment, Y = height) with a rectangular hole cut for every opening
 * that belongs to this wall — then ExtrudeGeometry pushes it out to the
 * wall's thickness. This is what actually punches doors/windows through
 * in 3D; the earlier version only floated a translucent marker plane in
 * front of a solid box, so the wall never really had a hole in it.
 *
 * Holes are positioned using each opening's positionOnWall against the
 * WALL's own start/end (that's what positionOnWall is parametric over),
 * then re-projected onto the SEGMENT's local X axis — segment.start/end
 * are wall.start/end extended outward along the same direction to close
 * miter gaps (see computeExtendedWallSegments), so this projection is a
 * plain scalar distance-along-direction, not a rotation or a re-fit. */
function buildWallShape(
  wall: Wall,
  segment: { start: typeof wall.start; end: typeof wall.end },
  segmentLength: number,
  wallOpenings: Opening[],
) {
  const segDx = segment.end.x - segment.start.x;
  const segDz = segment.end.y - segment.start.y;
  const segLen = Math.hypot(segDx, segDz) || 1e-6;
  const segUx = segDx / segLen;
  const segUz = segDz / segLen;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(segmentLength, 0);
  shape.lineTo(segmentLength, wall.height);
  shape.lineTo(0, wall.height);
  shape.closePath();

  for (const opening of wallOpenings) {
    const worldCenter = pointAtParameter(wall, opening.positionOnWall);
    // Scalar projection of (worldCenter - segment.start) onto the
    // segment's own unit direction — since both are colinear, this is
    // just "how far along the segment this point sits", in meters.
    const localX = (worldCenter.x - segment.start.x) * segUx + (worldCenter.y - segment.start.y) * segUz;
    const halfW = opening.width / 2;
    const sill = opening.kind === 'DOOR' ? 0 : opening.sillHeight;
    // Clamp to the segment so a door near a mitered corner never asks
    // for a hole that pokes out past the wall's own extruded shape.
    const xMin = Math.max(0, localX - halfW);
    const xMax = Math.min(segmentLength, localX + halfW);
    const yMin = Math.max(0, sill);
    const yMax = Math.min(wall.height, sill + opening.height);
    if (xMax <= xMin || yMax <= yMin) continue; // degenerate — skip rather than crash the extrude

    // Three.js requires hole winding to be OPPOSITE the outer shape's
    // winding, or ExtrudeGeometry won't treat it as a hole. The outer
    // shape above goes (0,0) -> right -> up -> left, i.e.
    // counter-clockwise; this hole goes (xMin,yMin) -> up -> right ->
    // down, i.e. clockwise — deliberately reversed from the outer path.
    const hole = new THREE.Path();
    hole.moveTo(xMin, yMin);
    hole.lineTo(xMin, yMax);
    hole.lineTo(xMax, yMax);
    hole.lineTo(xMax, yMin);
    hole.closePath();
    shape.holes.push(hole);
  }

  return shape;
}

export function WallMesh({ wall, segment, selected, colorOverride, roughness, metalness, wallOpenings }: {
  wall: Wall;
  segment: { start: typeof wall.start; end: typeof wall.end };
  selected: boolean;
  /** Phase 8 — Visualization: optional Material Preview theme override for
   * the unselected color. Selected state always wins (still shows the
   * selection-blue highlight) — this only swaps the "normal" appearance.
   * As of Phase A this is also how a per-wall assigned material (resolved
   * via lib/material-resolver.ts against the wall's libraryItemId) reaches
   * the mesh — same prop, whichever caller resolved the color wins. */
  colorOverride?: string;
  /** Optional PBR fine-tuning carried from a resolved library MATERIAL
   * item. Omitted entirely (rather than defaulted here) when nothing
   * resolved, so meshStandardMaterial falls back to its own defaults. */
  roughness?: number;
  metalness?: number;
  /** This wall's own openings (already filtered by wallId by the caller)
   * — punched through as real holes. Defaults to none so any caller that
   * hasn't been updated still renders a plain solid wall instead of
   * crashing. */
  wallOpenings?: Opening[];
}) {
  const dx = segment.end.x - segment.start.x;
  const dz = segment.end.y - segment.start.y;
  const angle = Math.atan2(dz, dx);
  const length = Math.hypot(dx, dz);
  const center = {
    x: (segment.start.x + segment.end.x) / 2,
    z: (segment.start.y + segment.end.y) / 2,
  };

  const geometry = useMemo(() => {
    const shape = buildWallShape(wall, segment, length, wallOpenings ?? []);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: wall.thickness, bevelEnabled: false, curveSegments: 1 });
    // ExtrudeGeometry extrudes from local Z=0 to Z=depth, and the shape
    // itself runs from local X=0 to X=length — boxGeometry (what this
    // replaced) is centered on its own origin by default, so translate
    // to match: half the length back, half the thickness back, and the
    // whole thing is already Y=0-at-floor which is what the wrapping
    // <mesh> position (center.x, wall.height/2 -> now 0, center.z)
    // expects to build on top of.
    geo.translate(-length / 2, 0, -wall.thickness / 2);
    return geo;
    // wall and wallOpenings are whole-object deps rather than a field
    // list — buildWallShape reads wall.start/end/height/thickness and
    // several fields per opening (positionOnWall, width, height,
    // sillHeight, kind, swingDirection), and a field-by-field list here
    // would be one missed field away from a stale extruded shape after
    // an edit. segment/length are already derived from wall, so they'd
    // be redundant to also list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wall, segment, length, wallOpenings]);

  return (
    <mesh
      position={[center.x, 0, center.z]}
      rotation={[0, -angle, 0]}
      geometry={geometry}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={selected ? '#2D6CDF' : (colorOverride ?? '#E7E9EE')}
        roughness={selected ? undefined : roughness}
        metalness={selected ? undefined : metalness}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** A light indicator inside the now-real hole so doors and windows still
 * read as distinct at a glance in 3D — a thin door leaf plane (angled
 * open, echoing the plan symbol) or a pair of window glazing panes.
 * The wall itself now genuinely has no material here (see WallMesh /
 * buildWallShape), so unlike the old OpeningMarker this is a real
 * secondary object occupying the opening, not a patch hiding a solid
 * wall behind it. */
export function OpeningMarker({ opening, wall }: { opening: Opening; wall: Wall }) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const angle = Math.atan2(dz, dx);
  const center2D = pointAtParameter(wall, opening.positionOnWall);
  const isDoor = opening.kind === 'DOOR';
  const sill = isDoor ? 0 : opening.sillHeight;

  if (!isDoor) {
    // Window: a single glazed pane roughly centered in the wall's
    // thickness, inset slightly from the opening's full height so a
    // sill/head line reads at top and bottom.
    return (
      <mesh position={[center2D.x, sill + opening.height / 2, center2D.y]} rotation={[0, -angle, 0]} castShadow>
        <planeGeometry args={[opening.width * 0.92, opening.height * 0.92]} />
        <meshStandardMaterial color="#BFD7F2" transparent opacity={0.45} roughness={0.1} metalness={0.1} side={THREE.DoubleSide} />
      </mesh>
    );
  }

  // Door: a leaf plane swung open ~90°, matching the plan symbol's
  // hinge/swing convention rather than sitting flat and invisible in
  // the wall plane like the old marker did. hinge/openTip come from the
  // exact same helper FloorPlanCanvas uses for its 2D swing-arc symbol,
  // so the two views can never disagree about which way a door opens.
  const { hinge, openTip } = doorSwingGeometry(wall, opening);
  const leafMid = { x: (hinge.x + openTip.x) / 2, y: (hinge.y + openTip.y) / 2 };
  const leafAngle = Math.atan2(openTip.y - hinge.y, openTip.x - hinge.x);

  return (
    <mesh position={[leafMid.x, opening.height / 2, leafMid.y]} rotation={[0, -leafAngle, 0]} castShadow>
      <planeGeometry args={[opening.width, opening.height * 0.98]} />
      <meshStandardMaterial color="#B4620F" side={THREE.DoubleSide} />
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
  roughness,
  metalness,
}: {
  boundary: { x: number; y: number }[];
  thickness: number;
  elevation: number;
  color: string;
  selectedColor: string;
  selected: boolean;
  /** Optional PBR fine-tuning from a resolved library MATERIAL item —
   * currently only passed for Roof (the one PlanarBoxMesh user with its
   * own materialLabel/libraryItemId as of Phase A). Slab/Ceiling/
   * Foundation callers simply omit these and get renderer defaults. */
  roughness?: number;
  metalness?: number;
}) {
  // Extrudes the ACTUAL boundary polygon (any vertex count — the 2-click
  // rectangle fast path is just the 4-vertex case), not its bounding
  // box. A bounding-box boxGeometry was indistinguishable from the real
  // shape as long as every boundary was an axis-aligned rectangle, but
  // silently renders the wrong footprint now that Slab/Ceiling/
  // Foundation/Roof/Balcony can be custom polygons (an L-shaped roof
  // would fill in as its full rectangular bounding box instead).
  const geometry = useMemo(() => {
    if (boundary.length < 3) {
      // Degenerate input — fall back to a tiny flat box rather than
      // crashing ExtrudeGeometry on an empty/invalid shape.
      const geo = new THREE.BoxGeometry(0.05, thickness, 0.05);
      return geo;
    }
    const shape = new THREE.Shape();
    // Y is negated when building the shape (and again in each hole,
    // see below — none here, PlanarBoxMesh has no openings) because
    // rotateX(-90deg) below maps local Y -> world Z with a sign flip;
    // pre-negating here cancels that flip so world Z ends up matching
    // the boundary's plan Y directly instead of mirrored. Verified
    // numerically, not just algebraically, before relying on it.
    shape.moveTo(boundary[0].x, -boundary[0].y);
    for (let i = 1; i < boundary.length; i++) shape.lineTo(boundary[i].x, -boundary[i].y);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
    // ExtrudeGeometry builds in the shape's own local X/Y plane and
    // extrudes along local Z (range [0, thickness]) — this needs to lie
    // flat instead (footprint in world X/Z, thickness along world Y),
    // so rotate -90° around X. Verified numerically (not just by the
    // rotation-matrix algebra) that this alone maps local Z directly to
    // world Y in [0, thickness] with no extra flip or translate needed
    // — the wrapping <mesh position={[0, elevation, 0]}> then places
    // that [0, thickness] span at [elevation, elevation + thickness],
    // matching the bottom-face-at-elevation convention this component
    // already used before switching from a bounding-box boxGeometry to
    // a real extruded polygon.
    geo.rotateX(-Math.PI / 2);
    return geo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary, thickness]);

  return (
    <mesh position={[0, elevation, 0]} geometry={geometry} receiveShadow castShadow>
      <meshStandardMaterial
        color={selected ? selectedColor : color}
        roughness={selected ? undefined : roughness}
        metalness={selected ? undefined : metalness}
        side={THREE.DoubleSide}
      />
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
  const color = selected ? '#2D6CDF' : (colorOverride ?? '#B7C0D1');
  const landings = deriveStairLandings(stair);
  let elevationSoFar = 0;
  const flightGroups = stair.flights.map((flight, flightIndex) => {
    const dx = flight.end.x - flight.start.x;
    const dz = flight.end.y - flight.start.y;
    const totalRun = Math.hypot(dx, dz) || 1e-9;
    const angle = Math.atan2(dz, dx);
    const stepDepth = totalRun / flight.numberOfSteps;
    const baseElevation = elevationSoFar;
    elevationSoFar += flight.numberOfSteps * flight.riserHeight;

    return (
      <group key={flightIndex} position={[flight.start.x, baseElevation, flight.start.y]} rotation={[0, -angle, 0]}>
        {Array.from({ length: flight.numberOfSteps }).map((_, i) => {
          // Each step is its OWN box — only this step's tread depth
          // and riser height, positioned at its own cumulative height —
          // rather than every box spanning from the flight's start
          // through this step (which nested every earlier step fully
          // inside the next one, reading as a solid wedge/ramp instead
          // of distinct steps from any side-on viewing angle).
          const stepTopY = (i + 1) * flight.riserHeight;
          return (
            <mesh
              key={i}
              position={[i * stepDepth + stepDepth / 2, stepTopY / 2, 0]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[stepDepth, stepTopY, stair.width]} />
              <meshStandardMaterial color={color} />
            </mesh>
          );
        })}
      </group>
    );
  });

  const landingMeshes = landings.map((landing, i) => {
    const xs = landing.boundary.map((p) => p.x);
    const zs = landing.boundary.map((p) => p.y);
    const width = Math.max(0.05, Math.max(...xs) - Math.min(...xs));
    const depth = Math.max(0.05, Math.max(...zs) - Math.min(...zs));
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
    // Landing thickness matches one riser height so its top surface
    // sits flush with the last step of the flight below it.
    const thickness = stair.flights[landing.flightIndexBefore]?.riserHeight ?? 0.15;
    return (
      <mesh
        key={`landing-${i}`}
        position={[centerX, landing.elevation - thickness / 2, centerZ]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, thickness, depth]} />
        <meshStandardMaterial color={color} />
      </mesh>
    );
  });

  return (
    <>
      {flightGroups}
      {landingMeshes}
    </>
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
  height,
  libraryItems = [],
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
  const openingsByWallId = useMemo(() => {
    const map = new Map<string, Opening[]>();
    for (const opening of openings) {
      const list = map.get(opening.wallId) ?? [];
      list.push(opening);
      map.set(opening.wallId, list);
    }
    return map;
  }, [openings]);
  const lift = explodedView ? EXPLODE_LIFT : 0;
  const materialLookup = useMemo(() => buildMaterialLookup(libraryItems), [libraryItems]);

  return (
    <div
      style={{ height: height ?? '100%' }}
      className="overflow-hidden rounded-sheet border border-line bg-[#F6F7F9]"
    >
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
                wallOpenings={openingsByWallId.get(wall.id)}
              />
            );
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
          {roofs.map((r) => {
            const material = resolveMaterial(r, materialLookup, '#8B5E4A');
            return (
              <PlanarBoxMesh
                key={r.id}
                boundary={r.boundary}
                thickness={r.thickness}
                elevation={r.elevation}
                color={material.color}
                selectedColor="#2D6CDF"
                selected={false}
                roughness={material.roughness}
                metalness={material.metalness}
              />
            );
          })}
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
