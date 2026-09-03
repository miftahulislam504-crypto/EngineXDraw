'use client';

import { useEffect, useState } from 'react';
import { Button, PageHeader } from '@archibim/shared-ui';
import { useAuthStore } from '@/lib/auth-store';
import { subscribeToMyProjects, subscribeToBuildings } from '@/lib/projects';
import { getFloorsOnce, getWallsOnce, updateWallsPatchBatch } from '@/lib/floors';
import type { Project, Building } from '@archibim/object-model';

/**
 * Wall Height Review — fix-column-heights/page.tsx-এর wall-সংস্করণ।
 *
 * ⚠️ কেন Column tool-এর মতো "সব mismatch অটো-ফিক্স" না: Column সবসময়
 * base থেকে ঠিক floor-to-floor height পর্যন্ত যায় (handleCreateColumn-
 * এর কনভেনশন), তাই "height ≠ floorToFloorHeight" মানেই নিশ্চিতভাবে ভুল।
 * কিন্তু Wall ভিন্ন — একটা legitimate parapet-height low wall বা
 * ভবিষ্যতের partial-height partition wall-ও floorToFloorHeight থেকে
 * ইচ্ছাকৃতভাবে কম হতে পারে (Draw এখন পর্যন্ত এমন wall বানানোর UI না
 * থাকলেও, ডেটা মডেলে thickness/height যেকোনো ধনাত্মক সংখ্যা হতে পারে,
 * তাই ভবিষ্যতে বা পুরনো কোনো ম্যানুয়াল edit থেকে এমন wall থাকতে পারে)।
 * তাই এই tool শুধু scan করে mismatch তালিকা দেখায়, প্রতিটা wall-এ
 * আলাদা checkbox দিয়ে ইঞ্জিনিয়ার নিজে বেছে নেন কোনগুলো আসলেই
 * "floor height পর্যন্ত পৌঁছানো উচিত ছিল কিন্তু copyFloorElements()-এর
 * পুরনো বাগে (height হুবহু কপি হতো, দেখুন floors.ts-এর
 * copyFloorElements() param comment) ভুল height নিয়ে এসেছে" — ডিফল্টে
 * সব checked থাকে (বেশিরভাগ ক্ষেত্রেই এটাই হবে) কিন্তু আনচেক করার
 * সুযোগ থাকে।
 *
 * Column tool-এর মতোই client-side Firebase SDK (updateWallsPatchBatch,
 * floors.ts) ব্যবহার করে — মোবাইল-অনলি workflow-এর জন্য, কোনো
 * Node/Admin SDK লাগে না।
 */

const HEIGHT_MATCH_TOLERANCE_M = 0.001;

interface WallFix {
  floorId: string;
  floorName: string;
  wallId: string;
  wallLabel: string;
  oldHeight: number;
  newHeight: number;
  selected: boolean;
}

type ScanStatus = 'idle' | 'scanning' | 'scanned' | 'applying' | 'done' | 'error';

export default function FixWallHeightsPage() {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<string>('');

  const [status, setStatus] = useState<ScanStatus>('idle');
  const [fixes, setFixes] = useState<WallFix[]>([]);
  const [scannedCount, setScannedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);

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

  // প্রজেক্ট/বিল্ডিং পাল্টালে আগের স্ক্যান রেজাল্ট আর প্রাসঙ্গিক না
  useEffect(() => {
    setStatus('idle');
    setFixes([]);
    setErrorMsg(null);
    setAppliedCount(0);
  }, [projectId, buildingId]);

  async function scanBuilding() {
    if (!projectId || !buildingId) return;
    setStatus('scanning');
    setErrorMsg(null);
    setFixes([]);
    setScannedCount(0);

    try {
      const floors = await getFloorsOnce(projectId, buildingId);
      const found: WallFix[] = [];
      let scanned = 0;

      for (const floor of floors) {
        if (typeof floor.floorToFloorHeight !== 'number' || Number.isNaN(floor.floorToFloorHeight)) {
          continue;
        }
        const walls = await getWallsOnce(projectId, buildingId, floor.id);
        for (const wall of walls) {
          scanned += 1;
          if (typeof wall.height !== 'number' || Number.isNaN(wall.height)) continue;
          if (Math.abs(wall.height - floor.floorToFloorHeight) > HEIGHT_MATCH_TOLERANCE_M) {
            found.push({
              floorId: floor.id,
              floorName: floor.name || floor.id,
              wallId: wall.id,
              wallLabel: `${wall.start.x.toFixed(2)},${wall.start.y.toFixed(2)} → ${wall.end.x.toFixed(2)},${wall.end.y.toFixed(2)}`,
              oldHeight: wall.height,
              newHeight: floor.floorToFloorHeight,
              selected: true,
            });
          }
        }
      }

      setScannedCount(scanned);
      setFixes(found);
      setStatus('scanned');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'অজানা এরর — স্ক্যান ব্যর্থ হয়েছে।');
      setStatus('error');
    }
  }

  function toggleFix(wallId: string) {
    setFixes((prev) => prev.map((f) => (f.wallId === wallId ? { ...f, selected: !f.selected } : f)));
  }

  async function applyFixes() {
    const selectedFixes = fixes.filter((f) => f.selected);
    if (selectedFixes.length === 0) return;
    setStatus('applying');
    setErrorMsg(null);
    setAppliedCount(0);

    try {
      // updateWallsPatchBatch একটা single floor-এর জন্য একবারে কাজ করে
      // এবং একটাই patch সব wallId-তে বসায় — column tool-এর মতোই
      // floor+newHeight দিয়ে group করা হচ্ছে, যাতে প্রতিটা wall তার
      // নিজের সঠিক (floor-অনুযায়ী) height পায়।
      const byFloorAndHeight = new Map<string, WallFix[]>();
      for (const fix of selectedFixes) {
        const key = `${fix.floorId}::${fix.newHeight}`;
        const list = byFloorAndHeight.get(key) ?? [];
        list.push(fix);
        byFloorAndHeight.set(key, list);
      }

      let done = 0;
      for (const [, group] of byFloorAndHeight) {
        const { floorId, newHeight } = group[0];
        await updateWallsPatchBatch(
          projectId,
          buildingId,
          floorId,
          group.map((g) => g.wallId),
          { height: newHeight },
        );
        done += group.length;
        setAppliedCount(done);
      }

      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'অজানা এরর — apply ব্যর্থ হয়েছে।');
      setStatus('error');
    }
  }

  const fixesByFloor = new Map<string, WallFix[]>();
  for (const fix of fixes) {
    const key = `${fix.floorName} (${fix.floorId})`;
    const list = fixesByFloor.get(key) ?? [];
    list.push(fix);
    fixesByFloor.set(key, list);
  }

  const selectedCount = fixes.filter((f) => f.selected).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="ইউটিলিটি" title="Wall Height Review" />
      <p className="-mt-4 text-sm text-ink-muted">
        যেসব wall-এর height তাদের নিজের floor-এর floorToFloorHeight-এর সাথে মিলছে না, সেগুলো
        খুঁজে দেখায় — সাধারণত Copy Floor-এর পুরনো বাগ (height উৎস floor থেকে হুবহু কপি হতো) এর
        ফলাফল, Structural App-এর &quot;end point not connected&quot; Model Checker error-এর একটা
        কারণ। Column-এর মতো এখানে সব mismatch স্বয়ংক্রিয়ভাবে &quot;ভুল&quot; ধরা হয় না — নিচে
        প্রতিটা wall আলাদাভাবে বেছে/বাদ দিয়ে শুধু আসলেই ভুল হওয়া wall গুলো ঠিক করুন (ইচ্ছাকৃতভাবে
        কম-উচ্চতার wall থাকলে সেটার checkbox বাদ দিন)।
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

        <Button
          onClick={scanBuilding}
          disabled={!projectId || !buildingId || status === 'scanning' || status === 'applying'}
        >
          {status === 'scanning' ? 'স্ক্যান হচ্ছে...' : 'স্ক্যান করুন (Dry Run — কিছু লেখা হবে না)'}
        </Button>
        {(!projectId || !buildingId) && (
          <p className="text-sm text-ink-muted">
            উপরে প্রজেক্ট ও বিল্ডিং দুটোই বেছে নিলে বাটন সক্রিয় হবে।
          </p>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-sheet border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          {errorMsg}
        </div>
      )}

      {(status === 'scanned' || status === 'applying') && (
        <div className="space-y-4 rounded-sheet border border-line-strong bg-surface p-5">
          <p className="text-sm text-ink-muted">মোট {scannedCount}টা wall স্ক্যান করা হয়েছে।</p>

          {fixes.length === 0 ? (
            <p className="text-sm font-medium text-ink">
              কোনো mismatch পাওয়া যায়নি — প্রতিটা wall-এর height ইতিমধ্যে তার floor-এর সাথে
              মিলছে।
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">
                {fixes.length}টা wall-এ mismatch পাওয়া গেছে ({selectedCount}টা নির্বাচিত):
              </p>
              <div className="max-h-96 space-y-3 overflow-y-auto text-sm">
                {Array.from(fixesByFloor.entries()).map(([floorKey, list]) => (
                  <div key={floorKey}>
                    <p className="font-medium text-ink">{floorKey}</p>
                    <ul className="ml-4 space-y-1">
                      {list.map((f) => (
                        <li key={f.wallId} className="flex items-center gap-2 text-ink-muted">
                          <input
                            type="checkbox"
                            checked={f.selected}
                            onChange={() => toggleFix(f.wallId)}
                            disabled={status === 'applying'}
                          />
                          <span>
                            wall ({f.wallLabel}): {f.oldHeight}m → {f.newHeight}m
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <Button
                variant="danger"
                onClick={applyFixes}
                disabled={status === 'applying' || selectedCount === 0}
              >
                {status === 'applying'
                  ? `লেখা হচ্ছে... (${appliedCount}/${selectedCount})`
                  : `${selectedCount}টা wall আপডেট করুন (Apply)`}
              </Button>
            </>
          )}
        </div>
      )}

      {status === 'done' && (
        <div className="rounded-sheet border border-line-strong bg-surface p-5 text-sm font-medium text-ink">
          সম্পন্ন — {appliedCount}টা wall-এর height ঠিক করা হয়েছে। এখন EngineXDraw থেকে আবার
          publish হয়ে গেলে (auto-sync) Structural App-এ &quot;Draw থেকে আনুন&quot; চাপলে সেই
          wall গুলো আর floating দেখানো উচিত না।
        </div>
      )}
    </div>
  );
}
