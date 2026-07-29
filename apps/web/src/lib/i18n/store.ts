'use client';

import { create } from 'zustand';
import type { Translations } from './translations';
import { en } from './en';
import { bn } from './bn';
import type { Locale } from '@archibim/object-model';

export type { Locale };

const DICTIONARIES: Record<Locale, Translations> = { en, bn };
const STORAGE_KEY = 'archibim-locale';

export interface I18nState {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
  /** Call once on the client after mount to pick up a saved preference —
   * not done automatically at store-creation time because localStorage
   * isn't available during SSR and this avoids a hydration mismatch. */
  hydrateFromStorage: () => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: 'en',
  t: en,
  setLocale: (locale) => {
    set({ locale, t: DICTIONARIES[locale] });
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }
  },
  hydrateFromStorage: () => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'bn') {
      set({ locale: saved, t: DICTIONARIES[saved] });
    }
  },
}));

/** Simple {n}-style placeholder interpolation — used for the relative-time
 * strings ("{n}m ago" -> "5m ago"). Not a full ICU pluralization system;
 * fine for this app's small set of count-based strings. */
export function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}
