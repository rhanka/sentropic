<script lang="ts">
  // Auth-surface theming: wrap the /auth screens in the DS ThemeProvider with the
  // `entropic` theme so @sentropic/auth-ui's native DS components (Button, Input,
  // Alert, Typography, Link) render the entropic primary instead of the legacy
  // hardcoded indigo. The svelte DS package has no styles.css export — ThemeProvider
  // injects the theme token CSS and the components self-style; no extra import.
  import { ThemeProvider } from '@sentropic/design-system-svelte';
  import { entropicTheme } from '@sentropic/design-system-themes';

  let { children: pageChildren } = $props();
</script>

<ThemeProvider theme={entropicTheme}>
  {#snippet children()}
    {@render pageChildren?.()}
  {/snippet}
</ThemeProvider>
