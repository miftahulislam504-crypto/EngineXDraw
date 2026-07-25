'use client';

import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { db } from './firebase-client';
import type { LibraryCategory, LibraryItem } from '@archibim/object-model';

function libraryCol() {
  return collection(db, 'libraryItems');
}

export function subscribeToLibrary(
  category: LibraryCategory | null,
  onChange: (items: LibraryItem[]) => void,
) {
  const q = category ? query(libraryCol(), where('category', '==', category)) : query(libraryCol());
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LibraryItem));
  });
}

export async function getLibraryOnce(category: LibraryCategory): Promise<LibraryItem[]> {
  const snap = await getDocs(query(libraryCol(), where('category', '==', category)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LibraryItem);
}

export async function createCustomLibraryItem(
  item: Omit<LibraryItem, 'id' | 'isCustom' | 'createdAt' | 'category'> & { category: LibraryCategory },
  createdBy: string,
) {
  await addDoc(libraryCol(), {
    ...item,
    isCustom: true,
    createdBy,
    createdAt: serverTimestamp(),
  });
}

// A small starter set per category — not an exhaustive catalog, just
// enough that the Library Browser has real, usable items to pick from
// instead of being empty. Anyone can add more via createCustomLibraryItem.
const STARTER_ITEMS: Array<{
  category: LibraryCategory;
  name: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultDepth?: number;
  manufacturer?: string;
  tags: string[];
}> = [
  { category: 'DOOR', name: 'Flush Door 900mm', defaultWidth: 0.9, defaultHeight: 2.1, tags: ['flush', 'interior'] },
  { category: 'DOOR', name: 'Panel Door 900mm', defaultWidth: 0.9, defaultHeight: 2.1, tags: ['panel', 'interior'] },
  { category: 'DOOR', name: 'Sliding Door 1800mm', defaultWidth: 1.8, defaultHeight: 2.1, tags: ['sliding', 'exterior'] },

  { category: 'WINDOW', name: 'Sliding Window 1200mm', defaultWidth: 1.2, defaultHeight: 1.2, tags: ['sliding'] },
  { category: 'WINDOW', name: 'Casement Window 900mm', defaultWidth: 0.9, defaultHeight: 1.2, tags: ['casement'] },
  { category: 'WINDOW', name: 'Fixed Window 1500mm', defaultWidth: 1.5, defaultHeight: 1.0, tags: ['fixed'] },

  { category: 'FURNITURE', name: 'Sofa 2-Seater', defaultWidth: 1.5, defaultHeight: 0.8, defaultDepth: 0.85, tags: ['seating'] },
  { category: 'FURNITURE', name: 'Dining Table 6-Seater', defaultWidth: 1.8, defaultHeight: 0.75, defaultDepth: 0.9, tags: ['dining'] },
  { category: 'FURNITURE', name: 'Bed Queen Size', defaultWidth: 1.5, defaultHeight: 0.5, defaultDepth: 2.0, tags: ['bedroom'] },

  { category: 'KITCHEN', name: 'Kitchen Counter 1500mm', defaultWidth: 1.5, defaultHeight: 0.9, defaultDepth: 0.6, tags: ['counter'] },
  { category: 'KITCHEN', name: 'Kitchen Island', defaultWidth: 1.2, defaultHeight: 0.9, defaultDepth: 0.8, tags: ['island'] },
  { category: 'KITCHEN', name: 'Refrigerator', defaultWidth: 0.75, defaultHeight: 1.8, defaultDepth: 0.7, tags: ['appliance'] },

  { category: 'BATHROOM', name: 'Western Commode', defaultWidth: 0.4, defaultHeight: 0.4, defaultDepth: 0.65, tags: ['fixture'] },
  { category: 'BATHROOM', name: 'Wash Basin', defaultWidth: 0.55, defaultHeight: 0.85, defaultDepth: 0.45, tags: ['fixture'] },
  { category: 'BATHROOM', name: 'Shower Enclosure', defaultWidth: 0.9, defaultHeight: 2.0, defaultDepth: 0.9, tags: ['enclosure'] },

  { category: 'LIGHTING', name: 'Ceiling Pendant Light', defaultWidth: 0.3, defaultHeight: 0.4, defaultDepth: 0.3, tags: ['pendant'] },
  { category: 'LIGHTING', name: 'Wall Sconce', defaultWidth: 0.2, defaultHeight: 0.3, defaultDepth: 0.15, tags: ['sconce'] },
  { category: 'LIGHTING', name: 'Recessed Downlight', defaultWidth: 0.15, defaultHeight: 0.1, defaultDepth: 0.15, tags: ['downlight'] },

  { category: 'LANDSCAPE', name: 'Mango Tree', defaultWidth: 3, defaultHeight: 5, defaultDepth: 3, tags: ['tree'] },
  { category: 'LANDSCAPE', name: 'Hedge Row', defaultWidth: 2, defaultHeight: 1, defaultDepth: 0.5, tags: ['hedge'] },
  { category: 'LANDSCAPE', name: 'Garden Bench', defaultWidth: 1.5, defaultHeight: 0.45, defaultDepth: 0.5, tags: ['seating'] },

  { category: 'VEHICLE', name: 'Sedan Car', defaultWidth: 1.8, defaultHeight: 1.5, defaultDepth: 4.5, tags: ['car'] },
  { category: 'VEHICLE', name: 'Motorcycle', defaultWidth: 0.8, defaultHeight: 1.2, defaultDepth: 2.0, tags: ['motorcycle'] },
  { category: 'VEHICLE', name: 'SUV', defaultWidth: 2.0, defaultHeight: 1.8, defaultDepth: 5.0, tags: ['car'] },

  { category: 'PLANT', name: 'Potted Palm', defaultWidth: 0.6, defaultHeight: 1.8, defaultDepth: 0.6, tags: ['potted'] },
  { category: 'PLANT', name: 'Flower Bed', defaultWidth: 1.5, defaultHeight: 0.3, defaultDepth: 0.6, tags: ['bed'] },
  { category: 'PLANT', name: 'Climbing Vine', defaultWidth: 0.3, defaultHeight: 2.0, defaultDepth: 0.2, tags: ['vine'] },

  { category: 'MATERIAL', name: '9-inch Brick Wall', defaultWidth: 0.229, defaultHeight: 3.05, tags: ['brick', 'exterior'] },
  { category: 'MATERIAL', name: '5-inch Brick Wall', defaultWidth: 0.127, defaultHeight: 3.05, tags: ['brick', 'interior'] },
  { category: 'MATERIAL', name: 'RCC Wall 150mm', defaultWidth: 0.15, defaultHeight: 3.05, tags: ['rcc', 'structural'] },
];

/** Idempotent — only inserts items that don't already exist by
 * (category, name). Safe to call every time the Library Browser opens.
 * Direct client-side write; no Cloud Function required. */
export async function ensureLibrarySeeded() {
  const existingSnap = await getDocs(query(libraryCol(), where('isCustom', '==', false)));
  const existingKeys = new Set(
    existingSnap.docs.map((d) => `${d.data().category}:${d.data().name}`),
  );

  const itemsToInsert = STARTER_ITEMS.filter(
    (item) => !existingKeys.has(`${item.category}:${item.name}`),
  );
  if (itemsToInsert.length === 0) return;

  const batch = writeBatch(db);
  for (const item of itemsToInsert) {
    batch.set(doc(libraryCol()), { ...item, isCustom: false, createdAt: serverTimestamp() });
  }
  await batch.commit();
}
