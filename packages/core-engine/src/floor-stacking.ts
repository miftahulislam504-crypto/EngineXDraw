import type { Floor } from '@archibim/object-model';

/**
 * Base elevation (meters, above/below the ground floor's finished level)
 * for every floor in a building, computed by stacking each floor's
 * `floorToFloorHeight` in level order. The floor with level 0 sits at
 * z=0; floors above (level > 0) stack upward using the height of every
 * floor below them; basements (level < 0) stack downward using their
 * own height. If no floor has level exactly 0 (shouldn't normally
 * happen, but the data doesn't force it), the lowest-level floor present
 * is used as the z=0 anchor instead, so this never throws or silently
 * drops a floor.
 *
 * This is the piece Live3DView's own comment flagged as not done yet
 * ("a true per-floor explode needs the design studio to load multiple
 * floors at once") — needed for Elevations, which have to show every
 * floor of a building stacked correctly, not just the one currently
 * open in the Design Studio.
 */
export function computeFloorBaseElevations(floors: Floor[]): Map<string, number> {
  const result = new Map<string, number>();
  if (floors.length === 0) return result;

  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const zeroIndex = sorted.findIndex((f) => f.level === 0);
  const anchorIndex = zeroIndex >= 0 ? zeroIndex : 0;

  let z = 0;
  for (let i = anchorIndex; i < sorted.length; i++) {
    result.set(sorted[i].id, z);
    z += sorted[i].floorToFloorHeight;
  }
  z = 0;
  for (let i = anchorIndex - 1; i >= 0; i--) {
    z -= sorted[i].floorToFloorHeight;
    result.set(sorted[i].id, z);
  }
  return result;
}
