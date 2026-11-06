<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { locale } from 'svelte-i18n';
  import LoginScreen from '@sentropic/cluster-mesh/ui/LoginScreen.svelte';
  import { createSentropicIdentityScreenPorts } from '$lib/services/cm-identity-screens';
  import { resolveOAuthAuthorizeContinuationUrl } from '$lib/services/oauth-transport';

  $: ports = createSentropicIdentityScreenPorts($locale, $page.url.searchParams, {
    navigate: goto,
    resumeOAuth: continuation => window.location.assign(resolveOAuthAuthorizeContinuationUrl(continuation)),
  });
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
  <LoginScreen {ports} />
</div>
