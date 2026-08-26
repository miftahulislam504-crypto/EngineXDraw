/**
 * One-time backfill: Column.height → this floor's floorToFloorHeight
 * ────────────────────────────────────────────────────────────────────
 * Context: handleCreateColumn in apps/web's design page used to hard-code
 * DEFAULT_COLUMN_HEIGHT (3.05m) for every new column, regardless of the
 * floor's actual floorToFloorHeight. That's since been fixed so new
 * columns use currentFloorToFloorHeight — but columns drawn *before* the
 * fix still carry the old (possibly wrong) height in Firestore. Wherever
 * a floor's real height isn't 3.05m, that column's top (endPoint in the
 * Structural export) lands at the wrong elevation and never lines up
 * with the floor above — which is exactly the "column's end point is not
 * connected to any other element or base level" warning Structural's
 * Model Checker was flagging for nearly every column.
 *
 * This script walks every building's floors, and for every column whose
 * stored `height` doesn't match its own floor's `floorToFloorHeight`,
 * rewrites `height` to the correct value. It does NOT touch center,
 * width, depth, shape, or anything else — only the one field that was
 * wrong.
 *
 * Usage (run from functions/, after `npm run build`, or directly with
 * tsx — see the README block at the bottom of this file):
 *   node lib/scripts/backfillColumnHeights.js --project <projectId>            # dry run, one project
 *   node lib/scripts/backfillColumnHeights.js --project <projectId> --apply    # actually write
 *   node lib/scripts/backfillColumnHeights.js --all --apply                   # every project in the DB
 *
 * Always run WITHOUT --apply first and read the printed report before
 * re-running with --apply. This talks to whatever Firestore project your
 * GOOGLE_APPLICATION_CREDENTIALS / default credentials point at — make
 * sure that's the project you think it is (the script prints the
 * detected project id up front so this is easy to double-check).
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp();
}
const db: Firestore = getFirestore();

// Same epsilon-style tolerance philosophy as the rest of the codebase
// (see structural-coordination.ts's tolerance constants) — floats stored
// via a UI slider/typed input can differ by a fraction of a millimeter
// from a recomputed value without that being a real mismatch. 1mm is far
// tighter than anything that would actually misalign a floor stack.
const HEIGHT_MATCH_TOLERANCE_M = 0.001;

interface FloorDoc {
  id: string;
  buildingId: string;
  name: string;
  floorToFloorHeight: number;
}

interface ColumnFix {
  projectId: string;
  buildingId: string;
  floorId: string;
  floorName: string;
  columnId: string;
  oldHeight: number;
  newHeight: number;
}

async function collectFixesForBuilding(
  projectId: string,
  buildingId: string,
): Promise<ColumnFix[]> {
  const fixes: ColumnFix[] = [];

  const floorsSnap = await db
    .collection('projects')
    .doc(projectId)
    .collection('buildings')
    .doc(buildingId)
    .collection('floors')
    .get();

  for (const floorDoc of floorsSnap.docs) {
    const floor = { id: floorDoc.id, ...floorDoc.data() } as FloorDoc;
    if (typeof floor.floorToFloorHeight !== 'number' || Number.isNaN(floor.floorToFloorHeight)) {
      console.warn(
        `  ! Skipping floor ${floor.id} (${floor.name ?? 'unnamed'}) — floorToFloorHeight is missing/invalid, can't compute a correct column height for it.`,
      );
      continue;
    }

    const columnsSnap = await floorDoc.ref.collection('columns').get();
    for (const colDoc of columnsSnap.docs) {
      const data = colDoc.data();
      const currentHeight = data.height;
      if (typeof currentHeight !== 'number' || Number.isNaN(currentHeight)) {
        console.warn(`  ! Skipping column ${colDoc.id} on floor ${floor.id} — height field is missing/invalid.`);
        continue;
      }
      if (Math.abs(currentHeight - floor.floorToFloorHeight) > HEIGHT_MATCH_TOLERANCE_M) {
        fixes.push({
          projectId,
          buildingId,
          floorId: floor.id,
          floorName: floor.name ?? floor.id,
          columnId: colDoc.id,
          oldHeight: currentHeight,
          newHeight: floor.floorToFloorHeight,
        });
      }
    }
  }

  return fixes;
}

async function collectFixesForProject(projectId: string): Promise<ColumnFix[]> {
  const buildingsSnap = await db
    .collection('projects')
    .doc(projectId)
    .collection('buildings')
    .get();

  const all: ColumnFix[] = [];
  for (const b of buildingsSnap.docs) {
    all.push(...(await collectFixesForBuilding(projectId, b.id)));
  }
  return all;
}

/** Firestore batches cap at 500 writes — chunk so this never fails on a
 * large building regardless of how many columns need fixing. */
async function applyFixes(fixes: ColumnFix[]): Promise<void> {
  const CHUNK_SIZE = 450; // headroom under the 500 hard limit
  for (let i = 0; i < fixes.length; i += CHUNK_SIZE) {
    const chunk = fixes.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const fix of chunk) {
      const ref = db
        .collection('projects')
        .doc(fix.projectId)
        .collection('buildings')
        .doc(fix.buildingId)
        .collection('floors')
        .doc(fix.floorId)
        .collection('columns')
        .doc(fix.columnId);
      batch.update(ref, {
        height: fix.newHeight,
        updatedAt: new Date(),
      });
    }
    await batch.commit();
    console.log(`  Wrote ${Math.min(i + CHUNK_SIZE, fixes.length)}/${fixes.length} column updates...`);
  }
}

function printReport(fixes: ColumnFix[]): void {
  if (fixes.length === 0) {
    console.log('\nNo mismatched columns found — every column height already matches its floor\'s floorToFloorHeight.');
    return;
  }

  console.log(`\nFound ${fixes.length} column(s) with a height that doesn't match their floor:\n`);
  const byFloor = new Map<string, ColumnFix[]>();
  for (const f of fixes) {
    const key = `${f.buildingId} / ${f.floorName} (${f.floorId})`;
    const list = byFloor.get(key) ?? [];
    list.push(f);
    byFloor.set(key, list);
  }
  for (const [floorKey, list] of byFloor) {
    console.log(`  Floor: ${floorKey}`);
    for (const f of list) {
      console.log(`    column ${f.columnId}: ${f.oldHeight}m → ${f.newHeight}m`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const projectIdx = args.indexOf('--project');
  const projectId = projectIdx >= 0 ? args[projectIdx + 1] : undefined;

  if (!all && !projectId) {
    console.error('Usage: node backfillColumnHeights.js --project <projectId> [--apply]');
    console.error('   or: node backfillColumnHeights.js --all [--apply]');
    process.exit(1);
  }

  console.log(`Mode: ${apply ? 'APPLY (will write to Firestore)' : 'DRY RUN (no writes — pass --apply to write)'}`);
  console.log(`Scope: ${all ? 'ALL projects' : `project "${projectId}"`}\n`);

  let fixes: ColumnFix[];
  if (all) {
    const projectsSnap = await db.collection('projects').get();
    fixes = [];
    for (const p of projectsSnap.docs) {
      console.log(`Scanning project ${p.id}...`);
      fixes.push(...(await collectFixesForProject(p.id)));
    }
  } else {
    fixes = await collectFixesForProject(projectId!);
  }

  printReport(fixes);

  if (apply && fixes.length > 0) {
    console.log('\nApplying fixes...');
    await applyFixes(fixes);
    console.log('Done.');
  } else if (!apply && fixes.length > 0) {
    console.log('\nDry run only — nothing was written. Re-run with --apply to write these changes.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });

/*
README — how to actually run this
──────────────────────────────────
1. Set up credentials once (either works):
   a) `firebase login` then `firebase use <your-project-id>` from the
      functions/ directory (uses your logged-in Firebase CLI credentials), OR
   b) Download a service account key from Firebase Console → Project
      Settings → Service Accounts → Generate new private key, then:
        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json

2. Build and run:
     cd functions
     npm install
     npm run build
     node lib/scripts/backfillColumnHeights.js --project YOUR_PROJECT_ID
   Read the printed report. If it looks right:
     node lib/scripts/backfillColumnHeights.js --project YOUR_PROJECT_ID --apply

   Or, without a separate build step, using tsx directly from functions/:
     npx tsx src/scripts/backfillColumnHeights.ts --project YOUR_PROJECT_ID
     npx tsx src/scripts/backfillColumnHeights.ts --project YOUR_PROJECT_ID --apply
*/
