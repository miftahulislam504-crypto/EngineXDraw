// apps/web/src/lib/hub/module-data.types.ts
//
// Ported from CivilOS Hub's lib/types/module-data.types.ts — only the
// ArchitecturalModuleData shape (this app's own outgoing shape); the
// Structural/Estimating/ProjectMgmt interfaces from Hub's copy aren't
// reproduced here since Draw never writes those. Field names below are
// kept byte-for-byte identical to Hub's copy — this is the contract
// PM app's module-data-shapes.ts (PmRelevantArchitecturalData) reads
// against, so a renamed field here would silently break that consumer.
//
// Every field stays optional, matching Hub's own note: a producing app
// may send this in stages (partial save), merge:true on the Hub side
// keeps whatever arrived earlier.

export interface ArchitecturalModuleData {
  // Schedules / quantities
  floorAreas?: unknown;
  roomSchedule?: unknown;
  wallSchedule?: unknown;
  doorSchedule?: unknown;
  windowSchedule?: unknown;
  finishSchedule?: unknown;
  ceilingSchedule?: unknown;
  stairSchedule?: unknown;
  rampSchedule?: unknown;
  roofSchedule?: unknown;
  siteDevelopment?: unknown;
  landscapeQuantities?: unknown;

  // Drawing settings / geometry references — grid/levels/
  // columnLocations/wallLocations/slabBoundaries/openings/
  // stairGeometry/roofGeometry/shaftOpenings continue to go through
  // the existing moduleMetadata (Storage-file) path via hub-write.ts's
  // publishArchitecturalModel — see that file's header comment for why
  // heavy geometry stays there instead of moving into this
  // structured-field document.
  //
  // floorLoadsDeadLoadSource is the one exception: it's a small lookup
  // table (referenced MATERIAL library items only, not full geometry),
  // and it's the critical input for Structural's Load Pipeline (Phase
  // 4 of the ecosystem sync plan) — so it's populated here, in the
  // structured-field document Structural already knows how to
  // subscribeToModuleData() against, rather than left only inside the
  // Storage-file blob a load-pipeline consumer would have to download
  // and parse just to read a handful of unit-weight numbers.
  floorLoadsDeadLoadSource?: unknown;

  // Aggregated quantities
  allArchitecturalQuantities?: unknown;
  finishQuantities?: unknown;
  doorWindowQuantities?: unknown;
  areaStatements?: unknown;
  roomData?: unknown;

  // PM-facing summary fields
  workBreakdownByFloor?: unknown;
  zoneInformation?: unknown;
  drawingStatus?: unknown;
  revisionStatus?: unknown;
  constructionSequenceReference?: unknown;
  floorWiseWorkBreakdown?: unknown;
  roomList?: unknown;
  spaceList?: unknown;
  area?: unknown;
  elevation?: unknown;
  drawingRevision?: unknown;
  milestonesArchitectural?: unknown;
}
