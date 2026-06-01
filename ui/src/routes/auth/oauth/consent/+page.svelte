<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import OAuthConsent from '@sentropic/auth-ui/components/OAuthConsent.svelte';
  import {
    createDefaultOAuthConsentLabels,
    createFrenchOAuthConsentLabels,
  } from '@sentropic/auth-ui';
  import { locale } from 'svelte-i18n';

  import { createSentropicOAuthConsentTransport } from '$lib/services/oauth-transport';

  const state = browser ? new URLSearchParams(window.location.search).get('state') ?? '' : '';
  const transport = createSentropicOAuthConsentTransport({
    onUnauthorized: () => {
      const returnUrl = browser ? `${window.location.pathname}${window.location.search}` : '/auth/oauth/consent';
      void goto(`/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    },
  });

  $: labels = ($locale ?? 'fr').startsWith('fr')
    ? createFrenchOAuthConsentLabels()
    : createDefaultOAuthConsentLabels();

  function handleRedirect(redirectTo: string): void {
    window.location.assign(redirectTo);
  }
</script>

<div class="min-h-screen bg-gray-50 px-4 py-10">
  <div class="mx-auto max-w-xl">
    {#if state}
      <OAuthConsent {state} {transport} {labels} onRedirect={handleRedirect} />
    {/if}
  </div>
</div>
