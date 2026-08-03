import type { Point2D, Stair, StairFlight } from '@archibim/object-model';
import { flightsTurnAtJoint } from '@archibim/object-model';

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

/** A landing's footprint between two consecutive turning flights, plus
 * which flights it connects — for rendering (2D plan + 3D) and for the
 * escape-route/footprint checks that need the stair's full occupied
 * area, not just its flights' centerlines. */
export interface StairLanding {
  boundary: Point2D[];
  /** Elevation (meters above the stair's own floor level) of the
   * landing's walking surface — the top of flight[flightIndexBefore],
   * i.e. where someone stands after climbing that flight and before
   * starting the next one. */
  elevation: number;
  flightIndexBefore: number;
  flightIndexAfter: number;
}

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
export function deriveStairLandings(stair: Stair): StairLanding[] {
  const landings: StairLanding[] = [];
  let elevationSoFar = 0;
  for (let i = 0; i < stair.flights.length - 1; i++) {
    const a = stair.flights[i];
    const b = stair.flights[i + 1];
    elevationSoFar += flightRiseHeight(a);
    if (!flightsTurnAtJoint(a, b)) continue;

    const gapDx = b.start.x - a.end.x;
    const gapDy = b.start.y - a.end.y;
    const gapLen = Math.hypot(gapDx, gapDy) || 1e-9;
    const gx = gapDx / gapLen;
    const gy = gapDy / gapLen;
    // Perpendicular to the gap direction — the landing's width axis.
    const px = -gy;
    const py = gx;
    const half = stair.width / 2;

    const corners: Point2D[] = [
      { x: a.end.x + px * half, y: a.end.y + py * half },
      { x: a.end.x - px * half, y: a.end.y - py * half },
      { x: b.start.x - px * half, y: b.start.y - py * half },
      { x: b.start.x + px * half, y: b.start.y + py * half },
    ];

    landings.push({
      boundary: corners,
      elevation: elevationSoFar,
      flightIndexBefore: i,
      flightIndexAfter: i + 1,
    });
  }
  return landings;
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
