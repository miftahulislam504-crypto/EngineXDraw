'use client';

/**
 * Draw → Hub Architectural Auto-Sync
 * ------------------------------------------------------------------
 * আগে design page-এ দুটো ম্যানুয়াল বাটন ছিল ("Publish to Hub",
 * "Send schedule to Estimating") — ব্যবহারকারীর নির্দেশ অনুযায়ী ডেটা
 * push করার জন্য কোনো বাটন থাকবে না, তাই এই hook সেই দুটো বাটনের কাজ
 * প্রতিস্থাপন করছে event-driven auto-sync দিয়ে, ঠিক EngineXProject-এর
 * usePmOutboundSync.ts এর একই প্যাটার্নে (debounce + onSnapshot)।
 *
 * এই building-এর যেকোনো floor-এ যেকোনো element (wall/room/column/...)
 * বদলালে, ৩ সেকেন্ড debounce করে publishArchitecturalToHub() (hub-
 * write.ts) কল হয় — যেটা নিজেই buildArchitecturalExport() দিয়ে পুরো
 * building fresh fetch করে schedule+geometry একসাথে Hub-এ পাঠায়
 * (দেখুন hub-write.ts এর file comment — কেন দুটো আলাদা document-এ না
 * পাঠিয়ে একসাথে পাঠানো হয়)। তাই এই hook নিজে কোনো element data রাখে
 * না/পাঠায় না — শুধু "কিছু একটা বদলেছে" জানলেই যথেষ্ট, publish
 * ফাংশনটাই fresh data নিজে নিয়ে নেয়। এটা usePmOutboundSync.ts থেকে
 * সরলীকৃত — PM-এর ক্ষেত্রে সব সোর্স ডেটা hook-এর নিজের কাছে জমা করে
 * একবারে পাঠাতে হয় (savePmModuleData নিজে fetch করে না), কিন্তু এখানে
 * publishArchitecturalToHub() নিজেই fetch+build+push সব করে বলে
 * duplicate state রাখার দরকার নেই।
 *
 * Multi-floor জটিলতা: এক building-এর একাধিক floor থাকে, প্রতিটার
 * নিজস্ব element sub-collection (walls/columns/...)। floor list নিজেই
 * dynamic (নতুন floor যোগ/মুছা যায়), তাই প্রতিটা floor-এর জন্য
 * subscribeToFloorElements() (floors.ts, Design Studio-ও এটাই canvas
 * দেখাতে ব্যবহার করে — একই ~15-listener fan-out, নতুন কিছু না) আলাদা
 * mount/unmount করা হয় floor list বদলানোর সাথে সাথে, একটা ref-এ
 * unsubscribe function গুলো ট্র্যাক করে।
 *
 * ডাবল-পাবলিশ এড়ানো: floor list বদলালে (নতুন floor যোগ) পুরনো সব
 * element-subscription tear down করে নতুন করে সব floor-এ আবার subscribe
 * করা হয় — প্রতিটা re-subscribe নিজে থেকেই প্রথম snapshot দেয়, যেটা
 * debounced push ট্রিগার করবে। এটা ইচ্ছাকৃত (floor যোগ করাও একটা model
 * পরিবর্তন, Hub-এ sync হওয়া উচিত) — কিন্তু debounce এর কারণে দ্রুত
 * পরপর কয়েকটা floor যোগ করলেও একবারই push হবে।
 */

import { useEffect, useRef, useState } from 'react';
import type { Floor } from '@archibim/object-model';
import { subscribeToFloors, subscribeToFloorElements } from '@/lib/floors';
import { publishArchitecturalToHub } from './hub-write';

const DEBOUNCE_MS = 3000;

export type ArchitecturalAutoSyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'error';

export interface ArchitecturalAutoSyncState {
  status: ArchitecturalAutoSyncStatus;
  lastError: string | null;
  lastSyncedVersion: number | null;
}

export function useArchitecturalAutoSync(
  projectId: string,
  buildingId: string | null,
): ArchitecturalAutoSyncState {
  const [state, setState] = useState<ArchitecturalAutoSyncState>({
    status: 'idle',
    lastError: null,
    lastSyncedVersion: null,
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // subscribeToFloorElements() প্রতিটা floor-এ আন্তরিকভাবে ~15টা আলাদা
  // Firestore listener (walls/openings/columns/.../gridLines প্রতিটার
  // নিজস্ব onSnapshot) — mount হওয়ার সাথে সাথে প্রতিটা নিজের প্রথম
  // snapshot আলাদাভাবে (async, ভিন্ন সময়ে) দেয়, ফলে onChange callback
  // building-এ ঢোকার সাথে সাথেই কয়েক ডজন বার ডাকা হয় কোনো real user
  // edit ছাড়াই। "প্রথম callback-টাই শুধু initial" ধরে নিলে ভুল হতো
  // (বাকি ~১৪টা initial snapshot-ও change হিসেবে গণ্য হয়ে যেত, mount-
  // এই একটা ভুয়া push ট্রিগার করতো)। তাই সময়-ভিত্তিক approach: mount-
  // এর পর একটা settle window (নিচে INITIAL_SETTLE_MS) এর মধ্যে আসা সব
  // callback "initial load"-এর অংশ ধরে নেওয়া হয়, ওই window পার হওয়ার
  // পর আসা callback-ই "real change" হিসেবে debounced push ট্রিগার করে।
  const initialSettleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const settledFloorIdsRef = useRef<Set<string>>(new Set());
  const INITIAL_SETTLE_MS = 2000;

  useEffect(() => {
    if (!buildingId) return;

    const pushToHub = async () => {
      setState((prev) => ({ ...prev, status: 'syncing' }));
      try {
        const result = await publishArchitecturalToHub(projectId, buildingId);
        if (result.success) {
          setState({ status: 'synced', lastError: null, lastSyncedVersion: result.moduleVersion });
        } else {
          setState((prev) => ({ ...prev, status: 'error', lastError: result.error }));
        }
      } catch (e) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          lastError: e instanceof Error ? e.message : 'Hub-এ sync করতে ব্যর্থ',
        }));
      }
    };

    const scheduleDebouncedPush = () => {
      setState((prev) => ({ ...prev, status: 'pending' }));
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(pushToHub, DEBOUNCE_MS);
    };

    // floor-element unsubscribe function গুলো এখানে জমা হয় — floor list
    // বদলালে সবগুলো tear down করে নতুন floor list দিয়ে আবার mount করা
    // হয় (নিচের subscribeToFloors callback এ)।
    let floorElementUnsubs: (() => void)[] = [];

    const mountFloorElementListeners = (floors: Floor[]) => {
      floorElementUnsubs.forEach((unsub) => unsub());
      floorElementUnsubs = [];
      initialSettleTimersRef.current.forEach((timer) => clearTimeout(timer));
      initialSettleTimersRef.current = new Map();
      settledFloorIdsRef.current = new Set();

      for (const floor of floors) {
        // এই floor "settled" (initial load শেষ) হিসেবে চিহ্নিত হওয়ার
        // আগ পর্যন্ত কোনো callback push ট্রিগার করবে না। settle timer
        // শুধু একবারই বসে (প্রতিটা callback-এ রিসেট হয় না) — যদি সত্যিই
        // কেউ ওই ২ সেকেন্ডের মধ্যে edit করে, সেটা miss হতে পারে, কিন্তু
        // debounce (৩ সেকেন্ড) তার পরও চলতে থাকবে বলে চূড়ান্ত push এর
        // আগে তা ধরা পড়বে যদি আরেকটা snapshot আসে; সম্পূর্ণ edge-case-
        // free না হলেও, mount-এ ভুয়া push এড়ানোর তুলনায় এটা যথেষ্ট
        // নিরাপদ ট্রেড-অফ।
        const settleTimer = setTimeout(() => {
          settledFloorIdsRef.current.add(floor.id);
        }, INITIAL_SETTLE_MS);
        initialSettleTimersRef.current.set(floor.id, settleTimer);

        const unsub = subscribeToFloorElements(projectId, buildingId, floor.id, () => {
          if (!settledFloorIdsRef.current.has(floor.id)) return;
          scheduleDebouncedPush();
        });
        floorElementUnsubs.push(unsub);
      }
    };

    const unsubFloors = subscribeToFloors(projectId, buildingId, (floors) => {
      mountFloorElementListeners(floors);
    });

    return () => {
      unsubFloors();
      floorElementUnsubs.forEach((unsub) => unsub());
      initialSettleTimersRef.current.forEach((timer) => clearTimeout(timer));
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [projectId, buildingId]);

  return state;
}
