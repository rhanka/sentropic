<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { locale } from 'svelte-i18n';
  import AuthMagicLinkVerify from '@sentropic/auth-ui/components/AuthMagicLinkVerify.svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { setUser } from '$lib/stores/session';
  import {
    createSentropicAuthTransport,
    resolveAuthUiLabels,
    toSentropicUser,
  } from '$lib/services/auth-transport';

  const transport = createSentropicAuthTransport();
  $: labels = resolveAuthUiLabels($locale);

  function tokenSource(): string | null {
    return $page.url.searchParams.get('token');
  }

  async function handleVerified(session: AuthUiSession): Promise<void> {
    if (session.user) {
      setUser(toSentropicUser(session.user));
    }
    if (session.sessionToken) {
      sessionStorage.setItem('sessionToken', session.sessionToken);
    }
    if (session.refreshToken) {
      sessionStorage.setItem('refreshToken', session.refreshToken);
    }
  }

  function handleRedirect(): void {
    goto('/dashboard');
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
  <AuthMagicLinkVerify
    {transport}
    {labels}
    {tokenSource}
    onVerified={handleVerified}
    onRedirect={handleRedirect}
  >
    <a slot="back-to-login" href="/auth/login" class="font-medium text-indigo-600 hover:text-indigo-500">
      {labels.magicLinkBackToLogin}
    </a>
  </AuthMagicLinkVerify>
</div>
