<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import OAuthConsent from '@sentropic/auth-ui/components/OAuthConsent.svelte';
  import {
    createDefaultOAuthConsentLabels,
    createFrenchOAuthConsentLabels,
  } from '@sentropic/auth-ui';
  import { locale } from '$lib/locale';
  import { createIdpOAuthConsentTransport } from '$lib/oauth-transport';

  const state = browser ? new URLSearchParams(window.location.search).get('state') ?? '' : '';
  const transport = createIdpOAuthConsentTransport({
    onUnauthorized: () => {
      const returnUrl = browser
        ? `${window.location.pathname}${window.location.search}`
        : '/auth/oauth/consent';
      void goto(`/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    },
  });

  let labels = $derived(
    ($locale ?? 'fr').startsWith('fr')
      ? createFrenchOAuthConsentLabels()
      : createDefaultOAuthConsentLabels(),
  );

  function handleRedirect(redirectTo: string): void {
    window.location.assign(redirectTo);
  }
</script>

<div class="px-4 py-10">
  <div class="mx-auto max-w-xl">
    {#if state}
      <OAuthConsent {state} {transport} {labels} onRedirect={handleRedirect} />
    {/if}
  </div>
</div>
