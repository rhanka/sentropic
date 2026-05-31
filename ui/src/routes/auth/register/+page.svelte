<script lang="ts">
  import { goto } from '$app/navigation';
  import { locale } from 'svelte-i18n';
  import AuthRegister from '@sentropic/auth-ui/components/AuthRegister.svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { setUser } from '$lib/stores/session';
  import {
    createSentropicAuthTransport,
    resolveAuthUiLabels,
    toSentropicUser,
  } from '$lib/services/auth-transport';

  const transport = createSentropicAuthTransport();
  $: labels = resolveAuthUiLabels($locale);

  async function handleRegistered(session: AuthUiSession): Promise<void> {
    setUser(toSentropicUser(session.user));
    if (session.sessionToken) {
      sessionStorage.setItem('sessionToken', session.sessionToken);
    }
    if (session.refreshToken) {
      sessionStorage.setItem('refreshToken', session.refreshToken);
    }
    setTimeout(() => {
      goto('/neutral');
    }, 2000);
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
  <AuthRegister {transport} {labels} onRegistered={handleRegistered}>
    <a slot="login-link" href="/auth/login" class="font-medium text-indigo-600 hover:text-indigo-500">
      {labels.registerAlreadyHaveAccount}
    </a>
  </AuthRegister>
</div>
