import { writable } from 'svelte/store';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'topai_theme_preference';
const THEME_CLASS_LIGHT = 'topai-theme-light';
const THEME_CLASS_DARK = 'topai-theme-dark';

const browser = typeof window !== 'undefined';

const readStoredPreference = (): ThemePreference => {
  if (!browser) return 'system';
  const raw = (localStorage.getItem(STORAGE_KEY) || 'system').trim().toLowerCase();
  if (raw === 'light' || raw === 'dark') return raw;
  return 'system';
};

const systemPrefersDark = (): boolean =>
  browser && window.matchMedia('(prefers-color-scheme: dark)').matches;

const resolveEffective = (preference: ThemePreference): 'light' | 'dark' =>
  preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;

const applyThemeClass = (effective: 'light' | 'dark'): void => {
  if (!browser) return;
  const root = document.documentElement;
  root.classList.remove(THEME_CLASS_LIGHT, THEME_CLASS_DARK);
  root.classList.add(effective === 'dark' ? THEME_CLASS_DARK : THEME_CLASS_LIGHT);
};

const themePreferenceStore = writable<ThemePreference>(readStoredPreference());

export const themePreference = {
  subscribe: themePreferenceStore.subscribe,
  set(next: ThemePreference): void {
    themePreferenceStore.set(next);
    if (!browser) return;
    localStorage.setItem(STORAGE_KEY, next);
    applyThemeClass(resolveEffective(next));
  },
  init(): void {
    const current = readStoredPreference();
    themePreferenceStore.set(current);
    applyThemeClass(resolveEffective(current));

    if (!browser) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const pref = readStoredPreference();
      if (pref === 'system') {
        applyThemeClass(resolveEffective(pref));
      }
    };
    media.addEventListener('change', handler);
  },
};

