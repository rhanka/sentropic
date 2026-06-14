<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthLogin from '@sentropic/auth-ui/components/AuthLogin.svelte';
  import { Link } from '@sentropic/design-system-svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { locale } from '$lib/locale';
  import { createIdpAuthTransport, resolveAuthUiLabels } from '$lib/auth-transport';
  import { resolveOAuthAuthorizeContinuationUrl } from '$lib/oauth-transport';

  const transport = createIdpAuthTransport();
  let labels = $derived(resolveAuthUiLabels($locale));

  // Same continuation contract as the product `ui/` login screen: after a
  // successful login the IdP resumes the OAuth authorize flow (`continue`) it
  // was redirected away from, or honours a plain `returnUrl`. The session
  // cookie is set same-origin by @sentropic/auth-hono — no SPA session store.
  async function handleLoggedIn(_session: AuthUiSession): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const oauthContinuation = params.get('continue');
    if (oauthContinuation) {
      window.location.assign(resolveOAuthAuthorizeContinuationUrl(oauthContinuation));
      return;
    }
    const returnUrl = params.get('returnUrl') || '/auth/signed-in';
    await goto(returnUrl);
  }
</script>

<div class="flex items-center justify-center px-4 pb-16 pt-6">
  <AuthLogin {transport} {labels} onLoggedIn={handleLoggedIn}>
    <Link slot="no-account" href="/auth/register" variant="standalone">
      {labels.loginNoAccount}
    </Link>
    <Link slot="register-new-device" href="/auth/register" variant="standalone">
      {labels.loginRegisterNewDevice}
    </Link>
  </AuthLogin>
</div>
