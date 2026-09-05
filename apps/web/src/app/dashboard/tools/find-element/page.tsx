'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, PageHeader } from '@archibim/shared-ui';
import { useAuthStore } from '@/lib/auth-store';
import { subscribeToMyProjects, subscribeToBuildings } from '@/lib/projects';
import {
  getFloorsOnce,
  getWallsOnce,
  getColumnsOnce,
  getBeamsOnce,
  getSlabsOnce,
  footingCrud,
  stairCrud,
  parapetCrud,
} from '@/lib/floors';
import type { Project, Building, Floor } from '@archibim/object-model';

/**
 * Find Element by ID — Structural App-এর Model Checker error message এ
 * (যেমন `column "SawKUhYFxDT0LgC7zPLK"`) দেখানো elementId টা Draw-এ
 * কোথায় (কোন floor, কোন category, কী geometry) তা খুঁজে বের করার টুল।
 *
 * কেন এটা দরকার (Miftahul, ২০২৬-০৯-০৫): hub-geometry-parser.ts এর
 * StructuralElement.elementId সবসময় Draw-এর ref.id-ই থাকে অপরিবর্তিত
 * (দেখুন সেই ফাইলের "human-readable display label" সেকশনের বাগফিক্স
 * কমেন্ট — label মানুষ-পাঠযোগ্য হলেও elementId ইচ্ছাকৃতভাবে অপরিবর্তিত
 * রাখা হয়েছে re-import overwrite safety-র জন্য)। অর্থাৎ Structural-এর
 * error-এ যে raw ID দেখা যায়, সেটা আসলে Draw-এর নিজের Firestore
 * document ID — কিন্তু Draw-এর UI-তে কোনো "ID দিয়ে সার্চ করো" ফিচার
 * নেই (canvas click-to-select আছে, ID lookup নেই)। এই টুল সেই ফাঁক পূরণ
 * করে: raw ID পেস্ট করলে পুরো building-এর প্রতিটা floor-এর প্রতিটা
 * প্রাসঙ্গিক category স্ক্যান করে exact match খুঁজে বের করে।
 *
 * শুধু ৭টা category স্ক্যান করা হয় — Wall, Column, Beam, Slab, Footing,
 * Stair, Parapet — কারণ hub-geometry-parser.ts এর ref.type switch
 * (এই ৭টা ছাড়া বাকি সব door/window/room/roof/ceiling/foundation ইত্যাদি
 * ইচ্ছাকৃতভাবে স্কিপ, "default" ব্র্যাঞ্চ) অনুযায়ী এই ৭টাই একমাত্র
 * category যা আদৌ Structural App-এ StructuralElement হয়ে পৌঁছায়, তাই
 * Model Checker error শুধু এই ৭টা থেকেই আসতে পারে। Shear Wall/Core Wall
 * আলাদা কোনো Draw collection না — ordinary wallsCol-এরই isShearWall
 * flag করা entry (PropertiesPanel.tsx দেখুন), তাই Wall scan-এই ধরা
 * পড়বে।
 *
 * এই স্ক্যান client-side Firebase SDK দিয়ে read-only (getOnce কল, কোনো
 * write নেই) — fix-column-heights/fix-wall-heights এর মতোই মোবাইল-অনলি
 * workflow-এর জন্য কোনো Admin SDK/local script লাগে না।
 */

type Category = 'wall' | 'column' | 'beam' | 'slab' | 'footing' | 'stair' | 'parapet';

const CATEGORY_LABELS: Record<Category, string> = {
  wall: 'Wall',
  column: 'Column',
  beam: 'Beam',
  slab: 'Slab',
  footing: 'Footing',
  stair: 'Stair',
  parapet: 'Parapet',
};

interface FoundMatch {
  category: Category;
  floorId: string;
  floorName: string;
  floorLevel: number;
  summary: string;
}

type ScanStatus = 'idle' | 'scanning' | 'done' | 'error';

export default function FindElementPage() {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<string>('');

  const [elementId, setElementId] = useState('');
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [matches, setMatches] = useState<FoundMatch[]>([]);
  const [floorsScanned, setFloorsScanned] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeToMyProjects(user.uid, setProjects);
  }, [user]);

  useEffect(() => {
    setBuildingId('');
    setBuildings([]);
    if (!projectId) return;
    return subscribeToBuildings(projectId, setBuildings);
  }, [projectId]);

  // প্রজেক্ট/বিল্ডিং পাল্টালে আগের রেজাল্ট আর প্রাসঙ্গিক না
  useEffect(() => {
    setStatus('idle');
    setMatches([]);
    setErrorMsg(null);
  }, [projectId, buildingId]);

  async function scan() {
    const id = elementId.trim();
    if (!projectId || !buildingId || !id) return;

    setStatus('scanning');
    setErrorMsg(null);
    setMatches([]);
    setFloorsScanned(0);

    try {
      const floors = await getFloorsOnce(projectId, buildingId);
      const sortedFloors = [...floors].sort((a, b) => a.level - b.level);
      const found: FoundMatch[] = [];

      for (const floor of sortedFloors) {
        const [walls, columns, beams, slabs, footings, stairs, parapets] = await Promise.all([
          getWallsOnce(projectId, buildingId, floor.id),
          getColumnsOnce(projectId, buildingId, floor.id),
          getBeamsOnce(projectId, buildingId, floor.id),
          getSlabsOnce(projectId, buildingId, floor.id),
          footingCrud.getOnce(projectId, buildingId, floor.id),
          stairCrud.getOnce(projectId, buildingId, floor.id),
          parapetCrud.getOnce(projectId, buildingId, floor.id),
        ]);

        const wall = walls.find((w) => w.id === id);
        if (wall) {
          found.push({
            category: 'wall',
            floorId: floor.id,
            floorName: floor.name || floor.id,
            floorLevel: floor.level,
            summary: `${wall.isShearWall ? 'Shear Wall' : wall.type} — (${wall.start.x.toFixed(2)}, ${wall.start.y.toFixed(2)}) → (${wall.end.x.toFixed(2)}, ${wall.end.y.toFixed(2)}), thickness ${wall.thickness}m, height ${wall.height}m`,
          });
        }

        const column = columns.find((c) => c.id === id);
        if (column) {
          found.push({
            category: 'column',
            floorId: floor.id,
            floorName: floor.name || floor.id,
            floorLevel: floor.level,
            summary: `center (${column.center.x.toFixed(2)}, ${column.center.y.toFixed(2)}), ${column.shape}, ${column.width}×${column.depth}m, height ${column.height}m`,
          });
        }

        const beam = beams.find((b) => b.id === id);
        if (beam) {
          found.push({
            category: 'beam',
            floorId: floor.id,
            floorName: floor.name || floor.id,
            floorLevel: floor.level,
            summary: `(${beam.start.x.toFixed(2)}, ${beam.start.y.toFixed(2)}) → (${beam.end.x.toFixed(2)}, ${beam.end.y.toFixed(2)}), ${beam.width}×${beam.depth}m`,
          });
        }

        const slab = slabs.find((s) => s.id === id);
        if (slab) {
          found.push({
            category: 'slab',
            floorId: floor.id,
            floorName: floor.name || floor.id,
            floorLevel: floor.level,
            summary: `${slab.boundary.length}-vertex boundary, thickness ${slab.thickness}m, elevation ${slab.elevation}m`,
          });
        }

        const footing = footings.find((f) => f.id === id);
        if (footing) {
          found.push({
            category: 'footing',
            floorId: floor.id,
            floorName: floor.name || floor.id,
            floorLevel: floor.level,
            summary: `center (${footing.center.x.toFixed(2)}, ${footing.center.y.toFixed(2)}), ${footing.width}×${footing.depth}m`,
          });
        }

        const stair = stairs.find((s) => s.id === id);
        if (stair) {
          found.push({
            category: 'stair',
            floorId: floor.id,
            floorName: floor.name || floor.id,
            floorLevel: floor.level,
            summary: `${stair.flights.length} flight${stair.flights.length !== 1 ? 's' : ''}, width ${stair.width}m — এই stair-এর কোনো একটা flight বা landing Structural-এ ফ্ল্যাগ হয়ে থাকতে পারে, পুরো stair ইউনিটটাই এখানে চেক করুন`,
          });
        }

        const parapet = parapets.find((p) => p.id === id);
        if (parapet) {
          found.push({
            category: 'parapet',
            floorId: floor.id,
            floorName: floor.name || floor.id,
            floorLevel: floor.level,
            summary: `(${parapet.start.x.toFixed(2)}, ${parapet.start.y.toFixed(2)}) → (${parapet.end.x.toFixed(2)}, ${parapet.end.y.toFixed(2)}), height ${parapet.height}m`,
          });
        }
      }

      setFloorsScanned(sortedFloors.length);
      setMatches(found);
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'অজানা এরর — স্ক্যান ব্যর্থ হয়েছে।');
      setStatus('error');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="ইউটিলিটি" title="Find Element by ID" />
      <p className="-mt-4 text-sm text-ink-muted">
        Structural App-এর Model Checker error-এ দেখানো elementId (যেমন{' '}
        <code className="rounded bg-surface px-1 py-0.5 text-xs">SawKUhYFxDT0LgC7zPLK</code>) পেস্ট
        করুন — এটা আসলে Draw-এর নিজস্ব Firestore document ID, তাই এই টুল সেই ID দিয়ে সরাসরি খুঁজে
        বলে দেবে কোন floor-এর কোন element এটা।
      </p>

      <div className="space-y-4 rounded-sheet border border-line-strong bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">প্রজেক্ট</span>
            <select
              className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— নির্বাচন করুন —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectName ?? p.id}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">বিল্ডিং</span>
            <select
              className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink disabled:opacity-50"
              value={buildingId}
              onChange={(e) => setBuildingId(e.target.value)}
              disabled={!projectId}
            >
              <option value="">— নির্বাচন করুন —</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.id}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Element ID</span>
          <input
            type="text"
            className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 font-mono text-sm text-ink"
            placeholder="SawKUhYFxDT0LgC7zPLK"
            value={elementId}
            onChange={(e) => setElementId(e.target.value)}
            disabled={!buildingId}
          />
        </label>

        <Button onClick={scan} disabled={!projectId || !buildingId || !elementId.trim() || status === 'scanning'}>
          {status === 'scanning' ? 'খোঁজা হচ্ছে...' : 'খুঁজুন'}
        </Button>
        {(!projectId || !buildingId) && (
          <p className="text-sm text-ink-muted">উপরে প্রজেক্ট ও বিল্ডিং বেছে নিলে বাটন সক্রিয় হবে।</p>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-sheet border border-danger/40 bg-danger/10 p-4 text-sm text-danger">{errorMsg}</div>
      )}

      {status === 'done' && (
        <div className="space-y-4 rounded-sheet border border-line-strong bg-surface p-5">
          <p className="text-sm text-ink-muted">{floorsScanned}টা floor-এ ৭টা category স্ক্যান করা হয়েছে।</p>

          {matches.length === 0 ? (
            <p className="text-sm font-medium text-ink">
              কোনো মিল পাওয়া যায়নি — ID-টা ঠিক আছে কিনা যাচাই করুন, অথবা element ইতিমধ্যে Draw-এ
              delete হয়ে গেছে (তাহলে Structural-এ re-import করে সেই stale reference সরিয়ে ফেলুন)।
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">{matches.length}টা জায়গায় পাওয়া গেছে:</p>
              <ul className="space-y-3 text-sm">
                {matches.map((m, i) => (
                  <li key={i} className="rounded-md border border-line-strong bg-paper p-3">
                    <p className="font-medium text-ink">
                      {CATEGORY_LABELS[m.category]} — {m.floorName} (level {m.floorLevel})
                    </p>
                    <p className="mt-1 text-ink-muted">{m.summary}</p>
                    <Link
                      href={`/projects/${projectId}/design?floorId=${m.floorId}&selectKind=${m.category}&selectId=${elementId.trim()}`}
                      className="mt-2 inline-block text-sm font-medium underline"
                    >
                      Draw-এ খুলুন (এই floor + এই element সিলেক্ট করা অবস্থায়)
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
