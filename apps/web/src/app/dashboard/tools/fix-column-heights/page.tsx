'use client';

import { useEffect, useState } from 'react';
import { Button, PageHeader } from '@archibim/shared-ui';
import { useAuthStore } from '@/lib/auth-store';
import { subscribeToMyProjects, subscribeToBuildings } from '@/lib/projects';
import { getFloorsOnce, getColumnsOnce, updateColumnsPatchBatch } from '@/lib/floors';
import type { Project, Building } from '@archibim/object-model';

/**
 * Column Height Backfill — in-app replacement for
 * functions/src/scripts/backfillColumnHeights.ts.
 *
 * সেই script কাজ করত ঠিকই, কিন্তু Firebase Admin SDK এবং Node লাগত —
 * যেখানে ডেভেলপমেন্ট পুরোপুরি মোবাইল থেকে, কোনো লোকাল কম্পিউটার ছাড়া,
 * শুধু GitHub commit → Vercel deploy দিয়ে চলে, সেখানে সেই script
 * আদৌ চালানোর কোনো উপায় নেই। এই পেজ একই ফিক্স — "column.height যেন তার
 * নিজের floor-এর floorToFloorHeight-এর সমান হয়" — কিন্তু client-side
 * Firebase SDK (firebase/firestore-এর writeBatch, updateColumnsPatchBatch
 * এর মধ্যে দিয়ে) ব্যবহার করে করে, ঠিক যেভাবে অ্যাপের বাকি সব write হয়।
 * Firestore rules অনুযায়ী যেকোনো signed-in ইউজারেরই এই collection-এ
 * write access আছে (firestore.rules দেখুন), তাই আলাদা কোনো admin
 * credential লাগে না — শুধু স্বাভাবিকভাবে লগইন করা থাকলেই চলবে।
 *
 * এটা কোনো স্থায়ী প্রোডাক্ট ফিচার না, বরং একবারের backfill utility —
 * ভবিষ্যতে দরকার হলে আবার ব্যবহার করা যাবে (যেমন কোনো পুরনো import বা
 * ম্যানুয়াল Firestore edit থেকে আবার mismatch তৈরি হলে), তাই সরিয়ে না
 * ফেলে dashboard-এর নিচে রাখা হলো।
 */

const HEIGHT_MATCH_TOLERANCE_M = 0.001;

interface ColumnFix {
  floorId: string;
  floorName: string;
  columnId: string;
  oldHeight: number;
  newHeight: number;
}

type ScanStatus = 'idle' | 'scanning' | 'scanned' | 'applying' | 'done' | 'error';

export default function FixColumnHeightsPage() {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<string>('');

  const [status, setStatus] = useState<ScanStatus>('idle');
  const [fixes, setFixes] = useState<ColumnFix[]>([]);
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
      const found: ColumnFix[] = [];
      let scanned = 0;

      for (const floor of floors) {
        if (typeof floor.floorToFloorHeight !== 'number' || Number.isNaN(floor.floorToFloorHeight)) {
          continue;
        }
        const columns = await getColumnsOnce(projectId, buildingId, floor.id);
        for (const col of columns) {
          scanned += 1;
          if (typeof col.height !== 'number' || Number.isNaN(col.height)) continue;
          if (Math.abs(col.height - floor.floorToFloorHeight) > HEIGHT_MATCH_TOLERANCE_M) {
            found.push({
              floorId: floor.id,
              floorName: floor.name || floor.id,
              columnId: col.id,
              oldHeight: col.height,
              newHeight: floor.floorToFloorHeight,
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

  async function applyFixes() {
    if (fixes.length === 0) return;
    setStatus('applying');
    setErrorMsg(null);
    setAppliedCount(0);

    try {
      // updateColumnsPatchBatch একটা single floor-এর জন্য একবারে কাজ
      // করে, তাই floor অনুযায়ী গ্রুপ করে প্রতিটা floor-এ আলাদা batch
      // পাঠানো হচ্ছে — কিন্তু প্রতিটা column তার নিজের সঠিক height
      // (তার নিজের floor অনুযায়ী) পাচ্ছে, একই patch সবার জন্য না
      // (যা updateColumnsPatchBatch-এর single-patch সিগনেচারে
      // সরাসরি সম্ভব না বলে column-ভিত্তিক আলাদা করে গ্রুপ করা হলো)।
      const byFloorAndHeight = new Map<string, ColumnFix[]>();
      for (const fix of fixes) {
        const key = `${fix.floorId}::${fix.newHeight}`;
        const list = byFloorAndHeight.get(key) ?? [];
        list.push(fix);
        byFloorAndHeight.set(key, list);
      }

      let done = 0;
      for (const [, group] of byFloorAndHeight) {
        const { floorId, newHeight } = group[0];
        await updateColumnsPatchBatch(
          projectId,
          buildingId,
          floorId,
          group.map((g) => g.columnId),
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

  const fixesByFloor = new Map<string, ColumnFix[]>();
  for (const fix of fixes) {
    const key = `${fix.floorName} (${fix.floorId})`;
    const list = fixesByFloor.get(key) ?? [];
    list.push(fix);
    fixesByFloor.set(key, list);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="ইউটিলিটি" title="Column Height Backfill" />
      <p className="-mt-4 text-sm text-ink-muted">
        যেসব column-এর height তাদের নিজের floor-এর floorToFloorHeight-এর সাথে মিলছে না, সেগুলো
        খুঁজে ঠিক করুন — Structural App-এর &quot;fully floating&quot; Model Checker error-এর root
        cause fix।
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
      </div>

      {errorMsg && (
        <div className="rounded-sheet border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          {errorMsg}
        </div>
      )}

      {status === 'scanned' && (
        <div className="space-y-4 rounded-sheet border border-line-strong bg-surface p-5">
          <p className="text-sm text-ink-muted">মোট {scannedCount}টা column স্ক্যান করা হয়েছে।</p>

          {fixes.length === 0 ? (
            <p className="text-sm font-medium text-ink">
              কোনো mismatch পাওয়া যায়নি — প্রতিটা column-এর height ইতিমধ্যে তার floor-এর সাথে মিলছে।
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">
                {fixes.length}টা column-এ mismatch পাওয়া গেছে:
              </p>
              <div className="max-h-80 space-y-3 overflow-y-auto text-sm">
                {Array.from(fixesByFloor.entries()).map(([floorKey, list]) => (
                  <div key={floorKey}>
                    <p className="font-medium text-ink">{floorKey}</p>
                    <ul className="ml-4 list-disc text-ink-muted">
                      {list.map((f) => (
                        <li key={f.columnId}>
                          column {f.columnId}: {f.oldHeight}m → {f.newHeight}m
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <Button variant="danger" onClick={applyFixes} disabled={status === 'applying'}>
                {status === 'applying'
                  ? `লেখা হচ্ছে... (${appliedCount}/${fixes.length})`
                  : `${fixes.length}টা column আপডেট করুন (Apply)`}
              </Button>
            </>
          )}
        </div>
      )}

      {status === 'done' && (
        <div className="rounded-sheet border border-line-strong bg-surface p-5 text-sm font-medium text-ink">
          সম্পন্ন — {appliedCount}টা column-এর height ঠিক করা হয়েছে। এখন EngineXDraw থেকে আবার
          publish করে Structural App-এ &quot;Draw থেকে আনুন&quot; চাপলে upper-floor column-গুলো আর
          floating দেখানো উচিত না।
        </div>
      )}
    </div>
  );
}
