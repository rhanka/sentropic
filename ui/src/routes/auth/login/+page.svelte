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

  // BR-39r L4 — OIDC `login_hint`: authorize forwards the hinted email as a plain `login_hint` param
  // so the login form can pre-scope the passkey challenge to the known user (advisory; passkey login
  // stays discoverable). Mirror the register page's `window.location.search` read.
  const loginParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const presetEmail = loginParams.get('login_hint') ?? undefined;

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
  <AuthLogin {transport} {labels} {presetEmail} onLoggedIn={handleLoggedIn}>
    <Link slot="no-account" href="/auth/register" variant="standalone">
      {labels.loginNoAccount}
    </Link>
    <Link slot="register-new-device" href="/auth/register" variant="standalone">
      {labels.loginRegisterNewDevice}
    </Link>
  </AuthLogin>
</div>
