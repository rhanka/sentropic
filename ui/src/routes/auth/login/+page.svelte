<script lang="ts">
  import { goto } from '$app/navigation';
  import { locale } from 'svelte-i18n';
  import AuthLogin from '@sentropic/auth-ui/components/AuthLogin.svelte';
  import { Link } from '@sentropic/design-system-svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { setUser } from '$lib/stores/session';
  import {
    createSentropicAuthTransport,
    resolveAuthUiLabels,
    toSentropicUser,
  } from '$lib/services/auth-transport';
  import { resolveOAuthAuthorizeContinuationUrl } from '$lib/services/oauth-transport';

  const transport = createSentropicAuthTransport();
  $: labels = resolveAuthUiLabels($locale);

  async function handleLoggedIn(session: AuthUiSession): Promise<void> {
    setUser(toSentropicUser(session.user));
    if (session.sessionToken) {
      sessionStorage.setItem('sessionToken', session.sessionToken);
    }
    if (session.refreshToken) {
      sessionStorage.setItem('refreshToken', session.refreshToken);
    }
    const params = new URLSearchParams(window.location.search);
    const oauthContinuation = params.get('continue');
    if (oauthContinuation) {
      window.location.assign(resolveOAuthAuthorizeContinuationUrl(oauthContinuation));
      return;
    }

    const returnUrl = params.get('returnUrl') || '/neutral';
    await goto(returnUrl);
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
  <AuthLogin {transport} {labels} onLoggedIn={handleLoggedIn}>
    <Link slot="no-account" href="/auth/register" variant="standalone">
      {labels.loginNoAccount}
    </Link>
    <Link slot="register-new-device" href="/auth/register" variant="standalone">
      {labels.loginRegisterNewDevice}
    </Link>
  </AuthLogin>
</div>
