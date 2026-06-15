<script lang="ts">
  import '../app.css';
  import { browser } from '$app/environment';
  import { ThemeProvider, AppHeader, LanguageToggle } from '@sentropic/design-system-svelte';
  import { entropicTheme } from '@sentropic/design-system-themes';
  import { locale, setLocale } from '$lib/locale';

  let { children: pageChildren } = $props();

  // Keep <html lang> in sync with the active locale on the client.
  $effect(() => {
    if (browser) document.documentElement.lang = $locale;
  });
</script>

<ThemeProvider theme={entropicTheme}>
  {#snippet children()}
    <div class="min-h-screen bg-gray-50">
      <AppHeader brandName="SENT" productName="Sentropic ID">
        {#snippet actions()}
          <LanguageToggle locale={$locale} onLocaleChange={(next) => setLocale(next)} />
        {/snippet}
      </AppHeader>
      {@render pageChildren()}
    </div>
  {/snippet}
</ThemeProvider>
