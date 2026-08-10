/**
 * Display-layer unit conversion: meters (the engine's only internal
 * unit — geometry, snapping, PDF export scales, Firestore storage all
 * stay in meters/mm exactly as before) <-> feet/inches (how the
 * Design Studio shows and accepts every length-type dimension to the
 * user). Nothing here changes what's stored; a LengthInput just
 * converts at the edges, the same way the old plain `Input type=
 * number` bound directly to a meter value.
 *
 * 1 foot = 0.3048 m exactly (international foot, the standard used by
 * every mainstream CAD/BIM tool for ft-in display).
 */
export const METERS_PER_FOOT = 0.3048;
export const FEET_PER_METER = 1 / METERS_PER_FOOT;
const INCHES_PER_FOOT = 12;

export interface FeetInches {
  /** Whole feet. Carries the sign for a negative length via `negative`
   * below rather than becoming -0, so 0 ft -6 in is representable. */
  feet: number;
  /** 0 <= inches < 12, rounded to the nearest fraction requested. Always
   * non-negative — sign lives on `negative`, not here. */
  inches: number;
  /** True if the original meters value was negative (rare — a wall
   * length is never negative, but an elevation delta or offset can
   * be). Callers that only ever handle positive lengths can ignore
   * this field entirely. */
  negative: boolean;
}

/** Converts meters to whole-feet + inches, rounding the inches to the
 * nearest 1/denominator (default 1/16", the finest a construction tape
 * measure normally marks) so the round-trip through a text input
 * doesn't show ugly repeating decimals like 6.0000001". */
export function metersToFeetInches(meters: number, denominator = 16): FeetInches {
  const totalInches = meters * FEET_PER_METER * INCHES_PER_FOOT;
  const negative = totalInches < 0;
  const absInches = Math.abs(totalInches);
  const roundedAbsInches = Math.round(absInches * denominator) / denominator;
  let feet = Math.floor(roundedAbsInches / INCHES_PER_FOOT + 1e-9);
  let inches = roundedAbsInches - feet * INCHES_PER_FOOT;
  // Carry: rounding could push inches up to (or past, by fp error) 12.
  if (inches >= INCHES_PER_FOOT - 1e-9) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches, negative };
}

/** Converts feet + inches back to meters. `feet` and `inches` are both
 * expected non-negative (whole feet, 0-11.99.. inches) — this is the
 * shape a two-box ft/in input naturally produces. Pass `negative: true`
 * for the rare negative-length case (an offset or elevation delta);
 * omit it (or pass false) for the normal case, same as the `negative`
 * field metersToFeetInches returns. */
export function feetInchesToMeters(feet: number, inches: number, negative = false): number {
  const totalInches = Math.abs(feet) * INCHES_PER_FOOT + Math.abs(inches);
  const meters = (totalInches / INCHES_PER_FOOT) * METERS_PER_FOOT;
  return negative ? -meters : meters;
}

/** Formats a meters value as a single "10 ft 6 in" (or "10'-6\"")
 * string for read-only display (labels, PDF text, summaries) — not for
 * editable inputs, which use separate feet/inch fields instead. */
export function formatFeetInches(meters: number, opts?: { style?: 'words' | 'marks'; denominator?: number }): string {
  const { feet, inches, negative } = metersToFeetInches(meters, opts?.denominator ?? 16);
  const inchesStr = Number.isInteger(inches) ? String(inches) : inches.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const sign = negative ? '-' : '';
  if (opts?.style === 'marks') {
    return `${sign}${feet}'-${inchesStr}"`;
  }
  return `${sign}${feet} ft ${inchesStr} in`;
}

/** Formats a square-meters value as square feet for area display
 * (room schedules, cover sheet totals) — area conversion is a simple
 * scalar (1 m² = 10.7639 ft²), no feet/inches split needed since area
 * isn't a length. */
export function sqMetersToSqFeet(sqMeters: number): number {
  return sqMeters * FEET_PER_METER * FEET_PER_METER;
}

/** Same idea as sqMetersToSqFeet but for volume (room ceiling-height ×
 * floor area) — 1 m³ = 35.3147 ft³. */
export function cubicMetersToCubicFeet(cubicMeters: number): number {
  return cubicMeters * FEET_PER_METER * FEET_PER_METER * FEET_PER_METER;
}
