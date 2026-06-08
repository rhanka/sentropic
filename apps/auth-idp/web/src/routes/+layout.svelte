<script lang="ts">
  import '../app.css';
  import { browser } from '$app/environment';
  import { locale, setLocale } from '$lib/locale';

  let { children } = $props();

  // Keep <html lang> in sync with the active locale on the client.
  $effect(() => {
    if (browser) document.documentElement.lang = $locale;
  });

  // STOPGAP (DS-approved): align the header to the DS look/tokens of ui/Header.svelte
  // (bg-white border-b h-14 max-w, SENT logo + subtitle, FR/EN <select>). To be
  // replaced by the published DS shell (@sentropic/design-system-svelte AppHeader +
  // LanguageToggle + IdentityMenu) once the package version/theme is wired.
  const onLocaleChange = (event: Event) =>
    setLocale((event.currentTarget as HTMLSelectElement).value as 'fr' | 'en');
</script>

<div class="min-h-screen bg-gray-50">
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
      <div class="flex items-baseline gap-2">
        <span class="text-base font-bold tracking-tight text-slate-900">SENT</span>
        <span class="text-sm text-slate-500">Sentropic&nbsp;ID</span>
      </div>
      <select
        class="rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
        value={$locale}
        onchange={onLocaleChange}
        aria-label="Language"
      >
        <option value="fr">FR</option>
        <option value="en">EN</option>
      </select>
    </div>
  </header>
  {@render children()}
</div>
