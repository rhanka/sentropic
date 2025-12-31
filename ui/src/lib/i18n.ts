import { browser } from '$app/environment';
import { init, locale, addMessages } from 'svelte-i18n';

import fr from '../locales/fr.json';
import en from '../locales/en.json';

const STORAGE_KEY = 'locale';
const FALLBACK_LOCALE = 'fr';

addMessages('fr', fr);
addMessages('en', en);

const initialLocale = browser ? (localStorage.getItem(STORAGE_KEY) || FALLBACK_LOCALE) : FALLBACK_LOCALE;

init({
  fallbackLocale: FALLBACK_LOCALE,
  initialLocale
});

export const setLocale = (value: string) => {
  const next = value || FALLBACK_LOCALE;
  if (browser) localStorage.setItem(STORAGE_KEY, next);
  locale.set(next);
};
