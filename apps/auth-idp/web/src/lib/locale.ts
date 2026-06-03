import { browser } from '$app/environment';
import { writable } from 'svelte/store';

// BR-39m A0-bis — minimal locale handling for the IdP screens front.
// The product `ui/` runs a full svelte-i18n stack, but the @sentropic/auth-ui
// components are self-contained (they take EN/FR label presets directly), so the
// IdP front only needs to pick the active language. We persist it in
// localStorage under the same `locale` key the product app uses, default FR.

export type IdpLocale = 'fr' | 'en';

const STORAGE_KEY = 'locale';

const detectInitialLocale = (): IdpLocale => {
  if (!browser) return 'fr';
  const stored = (localStorage.getItem(STORAGE_KEY) ?? '').trim().toLowerCase();
  if (stored.startsWith('en')) return 'en';
  if (stored.startsWith('fr')) return 'fr';
  const nav = (navigator.language ?? 'fr').toLowerCase();
  return nav.startsWith('en') ? 'en' : 'fr';
};

export const locale = writable<IdpLocale>(detectInitialLocale());

export const setLocale = (next: IdpLocale): void => {
  locale.set(next);
  if (browser) {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
  }
};
