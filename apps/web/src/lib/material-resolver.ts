import type { LibraryItem } from '@archibim/object-model';

/**
 * Phase A — Elevation/Render material fidelity.
 *
 * A Wall (and, as of this pass, a Roof) can carry `libraryItemId` pointing
 * at a MATERIAL-category LibraryItem. Until now nothing read that back at
 * render time — Live3DView/BuildingElevationView/BuildingRenderStudioView
 * only ever painted every wall in a building the same flat theme color.
 * This resolver is the one place that turns "an element's assigned
 * material" into "what meshStandardMaterial should actually show",
 * shared by all three view components so they can't drift out of sync.
 *
 * Falls back to `materialLabel` matched by name if `libraryItemId` isn't
 * set or the referenced item was deleted (a wall's Property System panel
 * lets material be set either way — see PropertiesPanel), and falls back
 * to the theme color if neither resolves to a real library item. This
 * mirrors how the rest of the codebase already treats material data as
 * optional/best-effort rather than a hard foreign key.
 */
export interface ResolvedMaterial {
  color: string;
  roughness?: number;
  metalness?: number;
}

/** Builds an id→item and name→item lookup once per library snapshot,
 * rather than each caller re-scanning the array — call sites resolve many
 * walls per render, so this is worth doing once at the view level. */
export function buildMaterialLookup(libraryItems: LibraryItem[]) {
  const byId = new Map<string, LibraryItem>();
  const byName = new Map<string, LibraryItem>();
  for (const item of libraryItems) {
    if (item.category !== 'MATERIAL') continue;
    byId.set(item.id, item);
    // Last-write-wins on name collisions — acceptable here since name is
    // only the fallback path when libraryItemId isn't available.
    byName.set(item.name, item);
  }
  return { byId, byName };
}

export type MaterialLookup = ReturnType<typeof buildMaterialLookup>;

/**
 * Resolves a single element's material against the lookup, falling back
 * to `fallbackColor` (the active theme's color for that element type) if
 * no material is assigned or the referenced item no longer exists.
 */
export function resolveMaterial(
  element: { libraryItemId?: string; materialLabel?: string },
  lookup: MaterialLookup,
  fallbackColor: string,
): ResolvedMaterial {
  const item =
    (element.libraryItemId ? lookup.byId.get(element.libraryItemId) : undefined) ??
    (element.materialLabel ? lookup.byName.get(element.materialLabel) : undefined);

  if (!item || !item.colorHex) {
    return { color: fallbackColor };
  }
  return { color: item.colorHex, roughness: item.roughness, metalness: item.metalness };
}
