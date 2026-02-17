export type AppLocale = 'fr' | 'en';

export function normalizeLocale(value: string | null | undefined): AppLocale | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('fr')) return 'fr';
  return null;
}

export function resolveLocaleFromHeaders(input: {
  appLocaleHeader?: string | null | undefined;
  acceptLanguageHeader?: string | null | undefined;
  fallback?: AppLocale;
}): AppLocale {
  const fromApp = normalizeLocale(input.appLocaleHeader);
  if (fromApp) return fromApp;

  const fromAcceptLanguage = normalizeLocale(input.acceptLanguageHeader);
  if (fromAcceptLanguage) return fromAcceptLanguage;

  return input.fallback ?? 'fr';
}
