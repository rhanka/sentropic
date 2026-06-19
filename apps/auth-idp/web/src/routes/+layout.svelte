<script lang="ts">
  import '../app.css';
  import { browser } from '$app/environment';
  import { ThemeProvider, AppChrome } from '@sentropic/design-system-svelte';
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
      <!-- Full DS top bar (the assembled design-system.sent-tech.ca chrome): brand + built-in
           language selector. Replaces the bare AppHeader strip (looked unstyled / "foireux"). -->
      <AppChrome
        brandName="SENT"
        productName="Sentropic ID"
        locale={$locale}
        onLocaleChange={setLocale}
      />
      {@render pageChildren()}
    </div>
  {/snippet}
</ThemeProvider>
