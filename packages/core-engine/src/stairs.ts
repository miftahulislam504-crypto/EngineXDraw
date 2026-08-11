import type { Point2D, Stair, StairFlight } from '@archibim/object-model';
import { flightsTurnAtJoint, DEFAULT_STAIR_RISER_HEIGHT } from '@archibim/object-model';

export function flightLength(flight: StairFlight): number {
  return Math.hypot(flight.end.x - flight.start.x, flight.end.y - flight.start.y);
}

export function flightRun(flight: StairFlight): number {
  // "Run" in the stair-design sense: total horizontal distance covered
  // by the flight's steps, same number as flightLength (steps run along
  // the flight's own line) — named separately from flightLength since
  // callers reasoning about tread depth want the stair-design term.
  return flightLength(flight);
}

/** Horizontal depth of a single tread, derived (not stored — same
 * "computed unless overridden" pattern the rest of this codebase uses
 * for Dimension.label/Opening.tag) from the flight's total run divided
 * by its step count. BNBC 2020 typically wants this in the 250–300mm
 * range for a residential stair; this doesn't enforce that, just
 * reports the number so a compliance check (or the Properties Panel)
 * can. */
export function treadDepth(flight: StairFlight): number {
  if (flight.numberOfSteps <= 0) return 0;
  return flightRun(flight) / flight.numberOfSteps;
}

export function flightRiseHeight(flight: StairFlight): number {
  return flight.numberOfSteps * flight.riserHeight;
}

export function stairTotalRise(stair: Stair): number {
  return stair.flights.reduce((sum, f) => sum + flightRiseHeight(f), 0);
}

export function stairTotalSteps(stair: Stair): number {
  return stair.flights.reduce((sum, f) => sum + f.numberOfSteps, 0);
}

/** A landing's footprint, plus which flight(s) it connects — for
 * rendering (2D plan + 3D) and for the escape-route/footprint checks
 * that need the stair's full occupied area, not just its flights'
 * centerlines.
 *
 * `kind: 'turn'` is the original mid-run case: real floor space between
 * two flights that change direction (see flightsTurnAtJoint) — nothing
 * to stand on between two steps of the same straight run, so a
 * non-turning joint never gets one of these.
 *
 * `kind: 'bottom' | 'top'` is the platform at either END of the stair —
 * where a person actually starts climbing (bottom) or steps off onto
 * the floor (top). Every stair gets both of these regardless of how
 * many flights it has or whether any of them turn; a single straight
 * flight (the common case drawn with one click-click, same gesture as
 * a wall) still needs a place to stand at the top before stepping onto
 * the floor, which is what was missing — see FloorPlanCanvas's stair
 * tool and the design page's screenshot report. flightIndexBefore/After
 * point at the one adjoining flight for these; the other index is -1
 * since there's no flight on that side. */
export interface StairLanding {
  kind: 'turn' | 'bottom' | 'top';
  boundary: Point2D[];
  /** Elevation (meters above the stair's own floor level) of the
   * landing's walking surface — the top of flight[flightIndexBefore],
   * i.e. where someone stands after climbing that flight and before
   * starting the next one. The bottom landing is elevation 0 (the
   * stair's own floor level); the top landing is the stair's total
   * rise (the floor above). */
  elevation: number;
  flightIndexBefore: number;
  flightIndexAfter: number;
}

/** Depth (meters, along the direction of travel) of the platform added
 * at each end of a stair. BNBC 2020 and most residential codes want a
 * landing at least as deep as the stair is wide; using the stair's own
 * width as the depth keeps this proportional (a wider stair gets a
 * proportionally deeper landing) while matching that minimum exactly
 * rather than a fixed number that would be oversized for a narrow
 * stair or undersized for a wide one. */
const MIN_END_LANDING_DEPTH = 0.9; // meters — floor below which a platform reads as unusably small even for a narrow stair

/** Builds the landing footprint between flight[i] and flight[i+1], for
 * every consecutive pair whose direction actually changes (see
 * flightsTurnAtJoint — a straight-run continuation between two flights
 * doesn't get a landing, there's nothing to stand on that isn't already
 * a step).
 *
 * A landing needs real physical depth to stand on, so flight[i+1] isn't
 * required to start exactly where flight[i] ends — the gap between them
 * (flight[i].end to flight[i+1].start) becomes the landing's own depth
 * axis, with the landing's width running perpendicular to that gap.
 * This is deliberately one formula for both an L-shaped stair (turn
 * with a short landing) and a U-shaped switchback (turn with a longer
 * landing spanning between two parallel, reversed flights, the more
 * common residential layout) — verified against both numerically
 * before relying on it, after an earlier version (corner points from
 * each flight's own cross-section, angle-sorted into a quadrilateral)
 * turned out to produce a diamond at half the correct area for an
 * L-turn and degenerate to zero area entirely for a switchback, since
 * it never actually used the real gap between the flights.
 *
 * A near-zero gap (flight[i+1] starting almost exactly where flight[i]
 * ends, for a tight L-turn) still works — the landing just comes out
 * very shallow — but a TRUE zero gap has no defined gap direction, so
 * degenerates to a zero-area landing; the multi-flight draw tool avoids
 * this by never letting flight[i+1]'s start land exactly on
 * flight[i]'s end when they turn (see FloorPlanCanvas's stair tool). */
/** A flight's own direction-of-travel (ux,uy) and width axis (nx,ny) —
 * the exact same pair FloorPlanCanvas uses to draw the flight's
 * rectangle, so any landing built from these axes is guaranteed to meet
 * the flight's drawn edge with zero gap and zero overshoot. */
function flightAxes(flight: StairFlight) {
  const dx = flight.end.x - flight.start.x;
  const dy = flight.end.y - flight.start.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  const ux = dx / len;
  const uy = dy / len;
  return { ux, uy, nx: -uy, ny: ux };
}

/** Builds the turn-landing boundary connecting flight `a` (ending) to
 * flight `b` (starting). Two genuinely different shapes depending on
 * how the flights turn — treating them with one formula was the source
 * of a real bug (landing corners bulging out past the flight's own
 * drawn width, into open space with no flight underneath):
 *
 *  - Switchback (a 180° turn, the U-shape preset's case — flights run
 *    parallel, opposite direction): the landing is a `stair.width`-deep
 *    strip sandwiched flush between the two flights' facing edges,
 *    spanning their full overlapping length. This matches the physical
 *    stairwell — the platform between the up-flight and the return
 *    flight is as long as the flights themselves, not a small square.
 *
 *  - Any other turn angle (an L-shaped corner, hand-drawn with the
 *    point-by-point stair tool): the landing is a compact
 *    `stair.width` × `stair.width` square centered on the joint. This
 *    never extends past either flight's own footprint by more than
 *    half the stair width, and stays well-defined for any turn angle
 *    (90°, or anything else a freeform-drawn stair might produce). */
function buildTurnLandingBoundary(a: StairFlight, b: StairFlight, stairWidth: number): Point2D[] {
  const half = stairWidth / 2;
  const A = flightAxes(a);
  const B = flightAxes(b);
  const dot = A.ux * B.ux + A.uy * B.uy;

  if (dot < -0.5) {
    // Switchback: find how far flight A and flight B overlap along A's
    // own travel direction (normally ~identical lengths, but computed
    // generally in case of a hand-edited stair), then build a
    // stair.width-deep strip across that overlap, flush against each
    // flight's facing edge (no gap, no overshoot past either flight).
    const projAStart = (a.start.x - a.end.x) * A.ux + (a.start.y - a.end.y) * A.uy;
    const projBStart = (b.start.x - a.end.x) * A.ux + (b.start.y - a.end.y) * A.uy;
    const projBEnd = (b.end.x - a.end.x) * A.ux + (b.end.y - a.end.y) * A.uy;
    const rangeAMin = Math.min(projAStart, 0);
    const rangeAMax = Math.max(projAStart, 0);
    const rangeBMin = Math.min(projBStart, projBEnd);
    const rangeBMax = Math.max(projBStart, projBEnd);
    const overlapMin = Math.max(rangeAMin, rangeBMin);
    const overlapMax = Math.min(rangeAMax, rangeBMax);
    // Flights that don't actually overlap in length (unusual hand-edit)
    // fall back to a stair.width-deep patch flush at a.end.
    const spanMin = overlapMin < overlapMax ? overlapMin : -stairWidth;
    const spanMax = overlapMin < overlapMax ? overlapMax : 0;

    const p1 = { x: a.end.x + A.ux * spanMin, y: a.end.y + A.uy * spanMin };
    const p2 = { x: a.end.x + A.ux * spanMax, y: a.end.y + A.uy * spanMax };

    const gapDx = b.start.x - a.end.x;
    const gapDy = b.start.y - a.end.y;
    const gapLen = Math.hypot(gapDx, gapDy) || 1e-9;
    const gx = gapDx / gapLen;
    const gy = gapDy / gapLen;
    const nearA = half;
    const nearB = Math.max(gapLen - half, half);

    return [
      { x: p1.x + gx * nearA, y: p1.y + gy * nearA },
      { x: p2.x + gx * nearA, y: p2.y + gy * nearA },
      { x: p2.x + gx * nearB, y: p2.y + gy * nearB },
      { x: p1.x + gx * nearB, y: p1.y + gy * nearB },
    ];
  }

  // L-turn / general corner: compact stair.width square centered on the
  // joint between a.end and b.start.
  const center = { x: (a.end.x + b.start.x) / 2, y: (a.end.y + b.start.y) / 2 };
  return [
    { x: center.x - half, y: center.y - half },
    { x: center.x + half, y: center.y - half },
    { x: center.x + half, y: center.y + half },
    { x: center.x - half, y: center.y + half },
  ];
}

export function deriveStairLandings(stair: Stair): StairLanding[] {
  const landings: StairLanding[] = [];
  if (stair.flights.length === 0) return landings;

  const half = stair.width / 2;
  const endLandingDepth = Math.max(MIN_END_LANDING_DEPTH, stair.width);

  // Bottom landing: a platform at the very start of flight 0, in the
  // direction opposite travel (so it sits before the first step, not
  // overlapping it) — where a person stands before starting to climb.
  const first = stair.flights[0];
  {
    const dx = first.end.x - first.start.x;
    const dy = first.end.y - first.start.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const backX = first.start.x - ux * endLandingDepth;
    const backY = first.start.y - uy * endLandingDepth;
    landings.push({
      kind: 'bottom',
      boundary: [
        { x: first.start.x + nx * half, y: first.start.y + ny * half },
        { x: first.start.x - nx * half, y: first.start.y - ny * half },
        { x: backX - nx * half, y: backY - ny * half },
        { x: backX + nx * half, y: backY + ny * half },
      ],
      elevation: 0,
      flightIndexBefore: -1,
      flightIndexAfter: 0,
    });
  }

  let elevationSoFar = 0;
  for (let i = 0; i < stair.flights.length - 1; i++) {
    const a = stair.flights[i];
    const b = stair.flights[i + 1];
    elevationSoFar += flightRiseHeight(a);
    if (!flightsTurnAtJoint(a, b)) continue;

    const corners = buildTurnLandingBoundary(a, b, stair.width);

    landings.push({
      kind: 'turn',
      boundary: corners,
      elevation: elevationSoFar,
      flightIndexBefore: i,
      flightIndexAfter: i + 1,
    });
  }

  // Top landing: a platform at the very end of the last flight, in the
  // direction travel continues — where a person steps off onto the
  // floor above. This is the one that was missing for a plain
  // single-flight stair (the common case): without it, the stair just
  // stops at the last step with nowhere solid drawn to step onto.
  const last = stair.flights[stair.flights.length - 1];
  {
    const dx = last.end.x - last.start.x;
    const dy = last.end.y - last.start.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const frontX = last.end.x + ux * endLandingDepth;
    const frontY = last.end.y + uy * endLandingDepth;
    landings.push({
      kind: 'top',
      boundary: [
        { x: last.end.x + nx * half, y: last.end.y + ny * half },
        { x: last.end.x - nx * half, y: last.end.y - ny * half },
        { x: frontX - nx * half, y: frontY - ny * half },
        { x: frontX + nx * half, y: frontY + ny * half },
      ],
      elevation: stairTotalRise(stair),
      flightIndexBefore: stair.flights.length - 1,
      flightIndexAfter: -1,
    });
  }

  return landings;
}

/** How far apart (meters, center-to-center) the two parallel flights of
 * a U-shape/switchback preset sit — needs to clear the stair's own
 * width so the up-flight and down-flight don't overlap, plus a little
 * headroom for the mid landing itself to read as a real platform
 * rather than a hairline gap. */
function uShapeFlightGap(stairWidth: number): number {
  return stairWidth + Math.max(0.9, stairWidth);
}

/** Reshapes a stair's flights into a standard U-shape (switchback):
 * two parallel straight flights, same total rise as before, connected
 * by a 180° turn at a mid landing — the most common residential/
 * stairwell layout (walk up half the rise, turn back on yourself, walk
 * up the rest, arriving above where you started). This is a *preset* —
 * a shortcut for reshaping an already-drawn stair — not a new drawing
 * tool; the stair itself is still created by the point-by-point stair
 * tool in FloorPlanCanvas (see handleCreateStair), same as before.
 *
 * Orientation is taken from the stair's existing first flight (its
 * start point and direction of travel), so applying the preset doesn't
 * relocate the stair on the plan — it just re-lays-out the flights
 * starting from the same spot the user originally drew.
 *
 * Total rise and total step count are preserved from the stair as
 * drawn (stairTotalRise / stairTotalSteps), split evenly between the
 * two flights (the standard case — an odd total step count puts the
 * extra step on the lower flight, matching common stair-shop practice
 * of never leaving the top flight one step short of a full landing
 * height). Width and riser height are also preserved (riser height
 * falls back to the object-model default only if the stair had no
 * flights to read it from — DEFAULT_STAIR_RISER_HEIGHT, the same
 * constant handleCreateStair uses for a brand new stair). */
export function applyUShapeStairPreset(stair: Stair): StairFlight[] {
  const first = stair.flights[0];
  const totalSteps = Math.max(2, stairTotalSteps(stair) || 12);
  const riserHeight = first?.riserHeight ?? DEFAULT_STAIR_RISER_HEIGHT;

  const lowerSteps = Math.ceil(totalSteps / 2);
  const upperSteps = totalSteps - lowerSteps;

  const origin: Point2D = first?.start ?? { x: 0, y: 0 };
  // Direction of travel for the lower (first) flight — reuse the
  // existing stair's orientation so the preset doesn't spin the stair
  // to a surprising new angle; default to +x if there's nothing to
  // read (a stair somehow created with zero flights).
  let dx = 1;
  let dy = 0;
  if (first) {
    const rawDx = first.end.x - first.start.x;
    const rawDy = first.end.y - first.start.y;
    const len = Math.hypot(rawDx, rawDy) || 1;
    dx = rawDx / len;
    dy = rawDy / len;
  }
  // Perpendicular direction — where the return flight sits, offset by
  // the gap so it doesn't overlap the first flight or its landing.
  const px = -dy;
  const py = dx;
  const gap = uShapeFlightGap(stair.width);

  const lowerRun = lowerSteps * treadDepthForPreset(stair.width);
  const lowerEnd: Point2D = { x: origin.x + dx * lowerRun, y: origin.y + dy * lowerRun };

  // Upper flight runs back the way it came (switchback), offset
  // sideways by `gap`, ending directly above (in plan) the point
  // `gap` away from the origin — i.e. the classic U shape.
  const upperStart: Point2D = { x: lowerEnd.x + px * gap, y: lowerEnd.y + py * gap };
  const upperRun = upperSteps * treadDepthForPreset(stair.width);
  const upperEnd: Point2D = { x: upperStart.x - dx * upperRun, y: upperStart.y - dy * upperRun };

  return [
    { start: origin, end: lowerEnd, numberOfSteps: lowerSteps, riserHeight },
    { start: upperStart, end: upperEnd, numberOfSteps: upperSteps, riserHeight },
  ];
}

/** A reasonable tread depth (meters) to lay out a preset flight's run
 * with — BNBC 2020's comfortable residential range is ~250-300mm; 275mm
 * sits in the middle. This only sizes the *preset's* initial geometry;
 * treadDepth() above still derives the real value from whatever run/
 * step-count the user ends up with after dragging endpoints or editing
 * numberOfSteps, same as any other stair. */
function treadDepthForPreset(_stairWidth: number): number {
  return 0.275;
}

/** Centroid-ish reference point for the whole stair — used by
 * escape-route graphing (checkEscapeRoute in compliance.ts), which only
 * needs "roughly where this stair is" to attach it to the nearest room,
 * not per-flight detail. Averages every flight's own midpoint rather
 * than just the first flight's, so an L-shaped stair's reference point
 * sits near its actual turn rather than skewed toward flight 1 alone. */
export function stairReferencePoint(stair: Stair): Point2D {
  const mids = stair.flights.map((f) => ({
    x: (f.start.x + f.end.x) / 2,
    y: (f.start.y + f.end.y) / 2,
  }));
  return {
    x: mids.reduce((s, p) => s + p.x, 0) / mids.length,
    y: mids.reduce((s, p) => s + p.y, 0) / mids.length,
  };
}
