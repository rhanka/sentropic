import { register, init, getLocaleFromNavigator, locale, waitLocale } from 'svelte-i18n';

register('fr', () => import('../locales/fr.json'));
register('en', () => import('../locales/en.json'));

init({
  fallbackLocale: 'fr',
  initialLocale: 'fr' // Force FR par défaut pour éviter les erreurs
});

// Attendre que la locale soit chargée avant de continuer
waitLocale('fr').then(() => {
  console.log('i18n initialized with locale: fr');
});

export const setLocale = (value: string) => {
  locale.set(value);
};
