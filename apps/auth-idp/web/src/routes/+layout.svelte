<script lang="ts">
  import '../app.css';
  import { browser } from '$app/environment';
  import { locale, setLocale } from '$lib/locale';

  let { children } = $props();

  // Keep <html lang> in sync with the active locale on the client.
  $effect(() => {
    if (browser) document.documentElement.lang = $locale;
  });
</script>

<div class="min-h-screen bg-gray-50">
  <header class="flex items-center justify-between px-6 py-4">
    <span class="text-sm font-semibold text-slate-700">Sentropic ID</span>
    <div class="flex items-center gap-1 text-xs">
      <button
        type="button"
        class="rounded px-2 py-1 font-medium {$locale === 'fr'
          ? 'bg-primary text-white'
          : 'text-slate-500 hover:bg-slate-200'}"
        onclick={() => setLocale('fr')}
      >
        FR
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 font-medium {$locale === 'en'
          ? 'bg-primary text-white'
          : 'text-slate-500 hover:bg-slate-200'}"
        onclick={() => setLocale('en')}
      >
        EN
      </button>
    </div>
  </header>
  {@render children()}
</div>
