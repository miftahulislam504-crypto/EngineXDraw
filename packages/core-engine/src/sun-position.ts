/**
 * Phase 6 — Analysis Suite, Pass 1: Sun & Shadow Study.
 *
 * Real solar geometry — the NOAA Solar Calculator's published algorithm
 * (itself derived from Jean Meeus, "Astronomical Algorithms"), accurate
 * to roughly ±0.01° for any date between 1800–2100. This is genuine
 * astronomy, not a simulation stand-in: given a moment in time and a
 * latitude/longitude, it returns exactly where the sun is in the sky.
 *
 * This is the piece of "Environmental Analysis" that's honestly
 * implementable in this stack — real-time shadow casting (via the sun
 * position driving a directional light + Three.js shadow maps in the 3D
 * view) needs nothing beyond this math and the geometry already modeled.
 * Daylight Analysis, Wind Flow, Natural Ventilation, Solar Radiation,
 * Heat Gain, Thermal Comfort, Energy Performance, and Carbon Footprint
 * are NOT covered here — see this module's sibling doc comments / the
 * roadmap for why each is a genuinely bigger lift (building-physics
 * simulation, material property data this object model doesn't hold, or
 * the Python/GPU pipeline the roadmap's own Tech Focus note calls for).
 */

export interface SunPosition {
  /** Degrees above the horizon. 0 = horizon, 90 = directly overhead,
   * negative = below the horizon (sun has set — no shadows to cast). */
  altitudeDeg: number;
  /** Degrees clockwise from true north (0 = N, 90 = E, 180 = S, 270 = W). */
  azimuthDeg: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Julian Day Number for any JS Date (JS Dates are always a real instant
 * in time — UTC internally — so no timezone handling is needed here; the
 * caller is responsible for constructing `date` to represent the actual
 * moment they mean, e.g. via `new Date(Date.UTC(...))` or a local Date
 * plus the browser's own timezone). */
function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Solar altitude + azimuth at an exact instant, for a given location.
 * latitudeDeg: -90..90 (north positive). longitudeDeg: -180..180 (east
 * positive) — matches SiteInfo's existing latitude/longitude fields.
 */
export function computeSunPosition(date: Date, latitudeDeg: number, longitudeDeg: number): SunPosition {
  const JD = julianDay(date);
  const T = (JD - 2451545.0) / 36525;

  let L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  L0 = ((L0 % 360) + 360) % 360;

  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const Mrad = toRad(M);

  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  const C =
    Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mrad) * 0.000289;

  const trueLong = L0 + C;

  const omega = 125.04 - 1934.136 * T;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega));

  const meanObliquitySeconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const meanObliquity = 23 + (26 + meanObliquitySeconds / 60) / 60;
  const correctedObliquity = meanObliquity + 0.00256 * Math.cos(toRad(omega));

  const declRad = Math.asin(Math.sin(toRad(correctedObliquity)) * Math.sin(toRad(apparentLong)));
  const decl = toDeg(declRad);

  // Equation of time, in minutes.
  const y = Math.pow(Math.tan(toRad(correctedObliquity) / 2), 2);
  const eqTimeDeg =
    y * Math.sin(2 * toRad(L0)) -
    2 * e * Math.sin(Mrad) +
    4 * e * y * Math.sin(Mrad) * Math.cos(2 * toRad(L0)) -
    0.5 * y * y * Math.sin(4 * toRad(L0)) -
    1.25 * e * e * Math.sin(2 * Mrad);
  const eqTimeMinutes = 4 * toDeg(eqTimeDeg);

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let trueSolarTime = (utcMinutes + eqTimeMinutes + 4 * longitudeDeg) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;

  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const latRad = toRad(latitudeDeg);
  const haRad = toRad(hourAngle);

  const cosZenith = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
  const zenithRad = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const zenith = toDeg(zenithRad);
  const altitude = 90 - zenith;

  const azDenominator = Math.cos(latRad) * Math.sin(zenithRad);
  let azimuth: number;
  if (Math.abs(azDenominator) < 1e-9) {
    // Sun at the zenith directly overhead (or the pole) — azimuth is
    // undefined at that exact instant; 180° (south) is as good a
    // convention as any and avoids a NaN.
    azimuth = 180;
  } else {
    const cosAz = (Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(declRad)) / azDenominator;
    const azBase = toDeg(Math.acos(Math.min(1, Math.max(-1, cosAz))));
    azimuth = hourAngle > 0 ? (azBase + 180) % 360 : (540 - azBase) % 360;
  }

  return { altitudeDeg: altitude, azimuthDeg: azimuth };
}

/** True when the sun is above the horizon — i.e. there's daylight to cast
 * a shadow from at all. */
export function isDaylight(sun: SunPosition): boolean {
  return sun.altitudeDeg > 0;
}

/**
 * Unit vector pointing from the scene toward the sun, in this platform's
 * world-space convention: +X world = plan +X (east), +Z world = plan +Y
 * (north), +Y world = up — the same convention BuildingElevationView's
 * N/S/E/W camera placement already relies on (north = +Z). A directional
 * light placed far along this vector (with its target at the scene's
 * center) reproduces the real sun direction for shadow casting.
 */
export function sunDirectionVector(sun: SunPosition): { x: number; y: number; z: number } {
  const altRad = toRad(sun.altitudeDeg);
  const azRad = toRad(sun.azimuthDeg);
  return {
    x: Math.cos(altRad) * Math.sin(azRad),
    y: Math.sin(altRad),
    z: Math.cos(altRad) * Math.cos(azRad),
  };
}
