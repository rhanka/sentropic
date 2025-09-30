import { register, init, getLocaleFromNavigator, locale } from 'svelte-i18n';

register('fr', () => import('../locales/fr.json'));
register('en', () => import('../locales/en.json'));

init({
  fallbackLocale: 'fr',
  initialLocale: getLocaleFromNavigator()
});

export const setLocale = (value: string) => {
  locale.set(value);
};
