/**
 * Phase 8 — Visualization, Pass 1: Material Preview + HDR Environment +
 * Lighting Preview.
 *
 * Deliberately a presentation-layer-only feature: these themes recolor
 * how the 3D view renders, they are not saved per-element in Firestore
 * and don't touch the object model at all — matching how real
 * visualization tools (SketchUp styles, Twinmotion material swaps used
 * for a client render) commonly separate "presentation override" from
 * the underlying model data. A future pass could promote this into a
 * real per-element material assignment system if that's wanted; this
 * pass intentionally keeps scope to the render only.
 *
 * "Lighting Preview" and "HDR Environment" are treated as one combined
 * control here rather than two separate features: drei's <Environment>
 * (the HDR environment map this stack already uses) simultaneously
 * supplies both image-based lighting AND reflections, so in this
 * rendering pipeline they are the same underlying mechanism, not two
 * independent systems to build separately.
 */

export type MaterialThemeId = 'default' | 'brickAndTile' | 'modernWhiteGlass' | 'warmWoodStucco';

export interface MaterialTheme {
  id: MaterialThemeId;
  labelKey: MaterialThemeId;
  wallColor: string;
  roofColor: string;
  slabColor: string;
  ceilingColor: string;
  concreteColor: string; // columns, beams, foundations, footings
  glassColor: string; // curtain walls, skylights
  accentColor: string; // railings, stair strings
  groundColor: string;
}

export const MATERIAL_THEMES: MaterialTheme[] = [
  {
    id: 'default',
    labelKey: 'default',
    wallColor: '#E7E9EE',
    roofColor: '#8B5E4A',
    slabColor: '#D8DEE9',
    ceilingColor: '#EDEFF3',
    concreteColor: '#9AA3B2',
    glassColor: '#BFE0F2',
    accentColor: '#8B93A7',
    groundColor: '#BFE3B4',
  },
  {
    id: 'brickAndTile',
    labelKey: 'brickAndTile',
    wallColor: '#B5654A',
    roofColor: '#7A3B2E',
    slabColor: '#C9C2B8',
    ceilingColor: '#E4DDD1',
    concreteColor: '#9C9284',
    glassColor: '#BFE0F2',
    accentColor: '#5C4A3A',
    groundColor: '#9FBF8C',
  },
  {
    id: 'modernWhiteGlass',
    labelKey: 'modernWhiteGlass',
    wallColor: '#F5F5F0',
    roofColor: '#4A4A4A',
    slabColor: '#E8E8E8',
    ceilingColor: '#FAFAFA',
    concreteColor: '#B0B0B0',
    glassColor: '#A8D8E8',
    accentColor: '#3A3A3A',
    groundColor: '#C7D6C0',
  },
  {
    id: 'warmWoodStucco',
    labelKey: 'warmWoodStucco',
    wallColor: '#D9C7A8',
    roofColor: '#6B4226',
    slabColor: '#C4B499',
    ceilingColor: '#EAE0CC',
    concreteColor: '#8F8776',
    glassColor: '#BFE0F2',
    accentColor: '#6B4226',
    groundColor: '#B8CC9E',
  },
];

/** drei's built-in <Environment preset="..."> HDR environments — the
 * full standard set drei ships with. */
export const ENVIRONMENT_PRESETS = [
  'apartment',
  'city',
  'dawn',
  'forest',
  'lobby',
  'night',
  'park',
  'studio',
  'sunset',
  'warehouse',
] as const;

export type EnvironmentPreset = (typeof ENVIRONMENT_PRESETS)[number];

export function findMaterialTheme(id: MaterialThemeId): MaterialTheme {
  return MATERIAL_THEMES.find((theme) => theme.id === id) ?? MATERIAL_THEMES[0];
}
