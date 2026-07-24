/**
 * Phase 5 — Building Intelligence.
 *
 * Pass 1 covered the four checks computable from data this platform
 * already had — FAR, Maximum Ground Coverage, Parking, and a Fire Rating
 * cross-check between differing room occupancies — plus a partial
 * Accessibility check (door clear width + ramp slope), with Setback left
 * as manual-entry-only (no site-boundary geometry existed yet).
 *
 * Pass 2 adds: a real SiteBoundary rectangle (see geometry.ts) so Setback
 * Validation can measure actual clearance instead of trusting a typed-in
 * number (manual entry remains the fallback when no SiteBoundary is
 * drawn), and Escape Route Validation — a room-to-exit travel-distance
 * graph over doors and stairs, checked against the BNBC/RAJUK Art.
 * 3.14.2 single-exit travel-distance figure.
 *
 * Still NOT in this pass: Structural Rule Validation and all of
 * Engineering Coordination (clash detection) need a structural model
 * this architectural platform doesn't have — that's a cross-app
 * integration decision (with the separate CivilOS Structural app), not a
 * data-table gap like everything else here, so it isn't guessed at.
 */

export type ComplianceCategory =
  | 'FAR'
  | 'GROUND_COVERAGE'
  | 'SETBACK'
  | 'PARKING'
  | 'FIRE_SAFETY'
  | 'ACCESSIBILITY'
  | 'ESCAPE_ROUTE';

export type ComplianceSeverity = 'error' | 'warning' | 'info';

export type ComplianceCheckType =
  | 'FAR_EXCEEDED'
  | 'FAR_OK'
  | 'GROUND_COVERAGE_EXCEEDED'
  | 'GROUND_COVERAGE_OK'
  | 'SETBACK_FRONT_INSUFFICIENT'
  | 'SETBACK_REAR_INSUFFICIENT'
  | 'SETBACK_SIDE_INSUFFICIENT'
  | 'SETBACK_OK'
  | 'SETBACK_NOT_ENTERED'
  | 'PARKING_INSUFFICIENT'
  | 'PARKING_OK'
  | 'FIRE_RATING_RECOMMENDED'
  | 'FIRE_RATING_OK'
  | 'DOOR_WIDTH_NARROW'
  | 'RAMP_SLOPE_STEEP'
  | 'ACCESSIBILITY_OK'
  | 'NO_SITE_AREA'
  | 'ESCAPE_ROUTE_TOO_FAR'
  | 'ESCAPE_ROUTE_UNREACHABLE'
  | 'ESCAPE_ROUTE_OK';

export interface ComplianceIssue {
  /** Stable within one compliance run — category + check + relatedId. */
  id: string;
  category: ComplianceCategory;
  severity: ComplianceSeverity;
  check: ComplianceCheckType;
  /** Numeric/string values to interpolate into the translated message
   * template for this check type via the app's existing
   * formatTemplate({n}-style) helper — e.g. { far: '4.10', allowed: '3.75' }. */
  values: Record<string, string | number>;
  relatedFloorId?: string;
  relatedElementId?: string;
}

/** One BNBC/RAJUK plot-size bracket row for residential (Group A1–A4)
 * occupancy at a given road width. Source: BNBC/RAJUK FAR & Maximum
 * Ground Coverage schedule for residential buildings — commonly
 * reproduced RAJUK reference table (6.0m / 9.0m / 12.0m / 18.0m / 24.0m
 * road-width columns). Treat as a verified starting dataset: cross-check
 * against the official BNBC 2020 Part 3 table for a specific submission,
 * and extend/correct the table in bnbcFarTable (core-engine) directly —
 * it's plain data, not logic, by design. */
export interface FarMgcRow {
  maxAreaSqm: number | null; // null = "greater than the previous row's max, no upper bound in this bracket"
  roadWidthM: number;
  far: number;
  mgcPercent: number;
}

/** One BNBC/RAJUK setback bracket row for residential occupancy, buildings
 * up to 10 storeys. Source: same RAJUK reference material as the FAR/MGC
 * table above. */
export interface SetbackRow {
  maxAreaSqm: number | null;
  frontM: number;
  rearM: number;
  sideM: number;
}
