import type { Point2D, Stair, StairFlight } from '@archibim/object-model';
import { flightsTurnAtJoint, DEFAULT_STAIR_RISER_HEIGHT, DEFAULT_STAIR_STEPS } from '@archibim/object-model';

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
  // Defensive: `flights` can be missing on a stair document written
  // before the multi-flight schema existed — treat that as zero rise
  // rather than throwing, matching the guards in deriveStairLandings/
  // FloorPlanCanvas/Live3DView.
  return (stair.flights ?? []).reduce((sum, f) => sum + flightRiseHeight(f), 0);
}

export function stairTotalSteps(stair: Stair): number {
  return (stair.flights ?? []).reduce((sum, f) => sum + f.numberOfSteps, 0);
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

    // Landing depth across the gap axis (perpendicular to travel,
    // between the two flights' facing edges): the landing must span
    // EXACTLY the real physical gap between the flights' FOOTPRINT
    // EDGES, flush against each, with no leftover strip and no
    // overshoot past either flight.
    //
    // `b.start - a.end` is NOT that gap — it's the distance between the
    // two flights' CENTERLINES. deriveUShapeStairFromRectangle places
    // each flight's centerline half a flight-width in from its own side
    // of the drawn rectangle (see its aOffset/bOffset), so the
    // centerlines end up a full `stairWidth` further apart than their
    // facing edges actually are: centerline gap = edge gap + half of
    // flight A's width + half of flight B's width. Using the raw
    // centerline distance as the landing depth (an earlier version of
    // this fix) made the landing balloon out far past both flights'
    // real edges — engulfing the flights themselves instead of sitting
    // as the slim connecting strip uShapeWellGap actually sized (the
    // reported swollen/overlapping landing). Subtracting each flight's
    // own half-width from the centerline distance recovers the true
    // edge-to-edge gap, so the landing lands exactly flush on both
    // flights' facing edges again — for both the 3-click stairU tool's
    // layout and applyUShapeStairPreset's, the two switchback producers
    // that reach this branch (an L-turn never does; it's handled by the
    // separate, unconditional branch below).
    const halfA = stairWidth / 2;
    const halfB = stairWidth / 2;
    const centerlineDx = b.start.x - a.end.x;
    const centerlineDy = b.start.y - a.end.y;
    const centerlineLen = Math.hypot(centerlineDx, centerlineDy) || 1e-9;
    const gx = centerlineDx / centerlineLen;
    const gy = centerlineDy / centerlineLen;
    // Fall back to a.end itself (edge gap 0) if the flights' own
    // half-widths already consume the whole centerline span — an
    // unusually tight or hand-edited stair — rather than letting the
    // strip invert to a negative depth.
    const gapLen = Math.max(1e-9, centerlineLen - halfA - halfB);
    const nearA = halfA;
    const nearB = halfA + gapLen;

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
  // Defensive: a Stair document written before `flights` existed (the
  // old single-flight schema) or otherwise missing/malformed data would
  // have `flights` as undefined/non-array here, which threw on
  // `.length` and crashed every screen that renders a floor plan
  // (Design Studio, the Sheet Manager's Floor Plan sheet, and the
  // Combined PDF export's off-screen batch capture, since all three
  // route through this same function). Treat that as "no stair to
  // draw" instead of a hard crash.
  if (!Array.isArray(stair.flights) || stair.flights.length === 0) return landings;

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
  // Defensive: same missing-`flights` case as stairTotalRise/
  // stairTotalSteps above — fall through to the "zero flights" default
  // path below (origin at 0,0, +x direction) instead of throwing.
  const flights = stair.flights ?? [];
  const first = flights[0];
  const riserHeight = first?.riserHeight ?? DEFAULT_STAIR_RISER_HEIGHT;

  // Fixed 12 steps per flight (24 total), not a total split in half.
  // A U-shape stair connects one floor to the next — the flight's
  // combined rise has to land exactly on the floor-above slab, and
  // splitting an arbitrary total unevenly (or re-deriving it from
  // whatever the stair happened to have before) drifts that landing
  // elevation away from the slab. Each flight climbing a fixed, equal
  // DEFAULT_STAIR_STEPS keeps both flights' rise identical and the
  // total rise a predictable multiple of the standard riser height.
  const lowerSteps = DEFAULT_STAIR_STEPS;
  const upperSteps = DEFAULT_STAIR_STEPS;

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
  // Perpendicular direction — where the return flight sits. Centerline
  // offset is uShapeWellGap(stair.width) PLUS a full stair.width — not
  // stair.width alone. buildTurnLandingBoundary's switchback case reads
  // this offset as the gap between the two flights' CENTERLINES, then
  // derives the actual walkable landing depth by subtracting each
  // flight's own half-width from that centerline distance (see its own
  // doc). So a centerline gap of exactly stair.width, as this used to
  // be set to, always nets out to a landing depth of stair.width minus
  // stair.width/2 minus stair.width/2 — i.e. zero: the two flights end
  // up touching edge-to-edge with no walkable strip between them at
  // all, regardless of how wide the stair is. Adding
  // uShapeWellGap(stair.width) on top of the width recovers a real,
  // physically-sized landing (uShapeWellGap deep, flush against both
  // flights, no floating extra gap) — the same landing depth
  // deriveUShapeStairFromRectangle's 3-click tool already produces, so
  // both ways of building a U-shape stair agree on how deep its mid
  // landing is.
  const px = -dy;
  const py = dx;
  const gap = stair.width + uShapeWellGap(stair.width);

  const lowerRun = lowerSteps * treadDepthForPreset(stair.width);
  const lowerEnd: Point2D = { x: origin.x + dx * lowerRun, y: origin.y + dy * lowerRun };

  // Upper flight runs back the way it came (switchback), starting
  // right at the far edge of the single mid-landing (gap away from
  // flight A's end), so the landing is the only platform between the
  // two flights — ending directly above (in plan) the point `gap`
  // away from the origin — i.e. the classic U shape.
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

/** Builds a U-shape (switchback) stair's {width, flights} directly from
 * three drawn points — the 3-click "U-stair" tool in FloorPlanCanvas
 * (see handleCreateStairU), distinct from applyUShapeStairPreset above
 * (which reshapes an *already-drawn* stair using a guessed tread depth,
 * not the user's own drawn dimensions).
 *
 *  - p1 -> p2 sets the TOTAL stairwell width (the click-1/click-2
 *    "width line") — the full opening the person is drawing the stair
 *    into, not a single flight's width.
 *  - p2 -> p3 sets the stair's total run direction and length (the
 *    click-2/click-3 "length line"), starting from p2 — i.e. the width
 *    line's second point is the shared corner both lines are drawn
 *    from, matching the L-shaped two-line click gesture the tool asks
 *    the user to draw (width first, then length from one end of it).
 *
 * The stairwell width is then split into two side-by-side flights with
 * a landing-depth gap between them (see uShapeWellGap) — each flight
 * getting half the remaining width — so the two flights plus the gap
 * exactly fill the width the person drew, matching a real switchback
 * stair (up one side, turn on a mid landing, down^H^H^Hup the other
 * side) rather than leaving the whole stairwell empty between two
 * flights pinned to its outer edges (the bug this function replaced —
 * see git history / uShapeWellGap's doc for the failure mode).
 *
 * Each flight's own numberOfSteps/riserHeight can be re-tuned
 * afterward in the Properties Panel, same as any other stair; the
 * total DEFAULT_STAIR_STEPS is split evenly (ceil on the lower flight
 * for an odd count) between the two flights here so the preset stair
 * already climbs a believable amount instead of doubling the total
 * rise across both flights. */
/** How wide (meters) the gap between the two flights' facing edges
 * should be, measured across the stairwell — this becomes the mid
 * landing's own depth (see buildTurnLandingBoundary's switchback case,
 * which builds a landing exactly this deep, flush against both
 * flights with zero extra space). A real BNBC-context stairwell keeps
 * this small — just enough to walk across when turning — never the
 * stairwell's full drawn width, which is what produced a stairwell-
 * sized void between the two flights instead of a proper turn landing
 * (the bug this function was rewritten to fix: the old version put
 * flight 0 on one long edge of the rectangle and flight 1 on the
 * opposite edge, leaving the *entire* rectangle width empty between
 * them rather than a landing-sized strip). 0.25m matches a typical
 * open-well residential stair; never wider than a third of the
 * stairwell so two flights this wide plus the gap still fit inside
 * the width the person actually drew. */
function uShapeWellGap(stairWidth: number): number {
  return Math.min(0.25, stairWidth / 3);
}

export function deriveUShapeStairFromRectangle(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D
): { width: number; flights: StairFlight[] } {
  const totalWidth = Math.max(0.1, Math.hypot(p2.x - p1.x, p2.y - p1.y));

  // Run direction: p2 -> p3, projected perpendicular to the width line
  // so a slightly-off-axis 3rd click still yields a clean rectangle
  // (right angle to the width line) instead of a sheared parallelogram.
  const wx = (p2.x - p1.x) / totalWidth;
  const wy = (p2.y - p1.y) / totalWidth;
  // Perpendicular to the width line, two choices — pick whichever one
  // the raw p2->p3 click roughly agrees with.
  let rx = -wy;
  let ry = wx;
  const rawRx = p3.x - p2.x;
  const rawRy = p3.y - p2.y;
  if (rawRx * rx + rawRy * ry < 0) {
    rx = -rx;
    ry = -ry;
  }
  const length = Math.max(0.1, rawRx * rx + rawRy * ry);

  // Split the drawn width into two flights side by side, each
  // `flightWidth` wide, separated by a landing-depth gap
  // (uShapeWellGap) — NOT the old two-opposite-edges layout, which
  // left the whole stairwell empty between the flights (see
  // uShapeWellGap's doc). p1->p2 is still the outer edge the person
  // drew; each flight's centerline sits half its own width in from
  // that edge, so the pair of flights plus the gap between them
  // exactly fill the drawn width with no leftover and no overlap.
  const gap = uShapeWellGap(totalWidth);
  const flightWidth = Math.max(0.1, (totalWidth - gap) / 2);

  // Flight A runs along the p1 side of the drawn rectangle, offset
  // half a flight-width in from the p1 edge.
  const aOffset = flightWidth / 2;
  const aStart: Point2D = { x: p1.x + wx * aOffset, y: p1.y + wy * aOffset };
  const aEnd: Point2D = { x: aStart.x + rx * length, y: aStart.y + ry * length };

  // Flight B runs along the p2 side, offset half a flight-width in
  // from the p2 edge, and travels the opposite direction (switchback)
  // — starting at the top of the run, ending back at the bottom, right
  // next to flight A's start, so the pair reads as a single U shape.
  const bOffset = flightWidth / 2;
  const bFar: Point2D = { x: p2.x - wx * bOffset, y: p2.y - wy * bOffset };
  const bNear: Point2D = { x: bFar.x + rx * length, y: bFar.y + ry * length };

  // Fixed DEFAULT_STAIR_STEPS (12) per flight — not split — so each
  // flight's rise lands exactly on the floor-above slab regardless of
  // riser height, matching applyUShapeStairPreset's same fixed-steps
  // rule above (their own numberOfSteps/riserHeight can still be
  // re-tuned afterward in the Properties Panel, same as any stair).
  const lowerSteps = DEFAULT_STAIR_STEPS;
  const upperSteps = DEFAULT_STAIR_STEPS;

  const flights: StairFlight[] = [
    { start: aStart, end: aEnd, numberOfSteps: lowerSteps, riserHeight: DEFAULT_STAIR_RISER_HEIGHT },
    { start: bNear, end: bFar, numberOfSteps: upperSteps, riserHeight: DEFAULT_STAIR_RISER_HEIGHT },
  ];

  return { width: flightWidth, flights };
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

/** How far past the stair's own footprint (meters, each side) an
 * auto-derived stair section line extends — long enough to read as a
 * real section cut through the surrounding walls rather than a line
 * that stops exactly at the stair's edge, without a magic per-project
 * number to configure. Matches the same order of magnitude as
 * MIN_END_LANDING_DEPTH above (a stair's own scale), not a fixed
 * building-wide constant, so it still looks proportional on a very
 * small or very large stair. */
const STAIR_SECTION_OVERSHOOT = 1.0; // meters

/**
 * Derives a whole-building-style SectionLine cut through a stair's
 * longest flight, for auto-generating a Staircase Section sheet without
 * requiring the person to draw the cut by hand first (see
 * generateStandardSheetSet's stair pass in sheets.ts). Cuts ACROSS the
 * flight's direction of travel (perpendicular to it, through the
 * flight's own midpoint) — the same orientation a real staircase
 * section is always drawn at, since cutting parallel to the run would
 * show a stair's edge-on profile instead of the risers/treads climbing
 * across the cut.
 *
 * Picks the LONGEST flight (by run length) rather than the first one,
 * so a dog-leg or U-shape stair's section is cut through its main climb
 * rather than an incidental short return flight — matching how a person
 * would choose the cut by hand.
 *
 * Returned as start/end/viewDirection only (no id/floorId/
 * createdAt/updatedAt/detailTarget) — the caller (generateStandardSheetSet)
 * owns turning this into a real persisted SectionLine with
 * detailTarget: { kind: 'stair', elementId: stair.id } set, the same
 * division of responsibility deriveUShapeStairFromRectangle already has
 * with its caller (handleCreateStairU owns persistence, this only
 * computes geometry).
 */
export function deriveStairSectionLine(
  stair: Stair,
): { start: Point2D; end: Point2D; viewDirection: 'left' | 'right' } | null {
  const flights = stair.flights ?? [];
  if (flights.length === 0) return null;

  const longest = flights.reduce((best, f) => (flightLength(f) > flightLength(best) ? f : best), flights[0]);
  const { ux, uy, nx, ny } = flightAxes(longest);
  const midX = (longest.start.x + longest.end.x) / 2;
  const midY = (longest.start.y + longest.end.y) / 2;

  const half = stair.width / 2 + STAIR_SECTION_OVERSHOOT;
  return {
    start: { x: midX - nx * half, y: midY - ny * half },
    end: { x: midX + nx * half, y: midY + ny * half },
    // Arbitrary but consistent: looking in the +travel-direction sense
    // (ux,uy) from the cut keeps every auto-generated stair section
    // framed the same way rather than flipping unpredictably stair to
    // stair — a person can still flip it by hand afterward like any
    // other SectionLine.
    viewDirection: ux + uy >= 0 ? 'right' : 'left',
  };
}
