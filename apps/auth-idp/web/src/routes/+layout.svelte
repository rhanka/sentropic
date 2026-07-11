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
      <!-- Full DS top bar (the assembled design-system.sent-tech.ca chrome): real branded
           SENT logo mark + wordmark + built-in language selector, consistent with the main
           app's canonical header. `logoSrc` renders the DS brand-zone mark (the same
           /SENT-logo-squared.svg asset the main app ships); the mark stays decorative
           (default empty alt) since the brand link is already labelled "SENT Sentropic ID". -->
      <AppChrome
        brandName="SENT"
        productName="Sentropic ID"
        logoSrc="/SENT-logo-squared.svg"
        locale={$locale}
        onLocaleChange={setLocale}
      />
      {@render pageChildren()}
    </div>
  {/snippet}
</ThemeProvider>
