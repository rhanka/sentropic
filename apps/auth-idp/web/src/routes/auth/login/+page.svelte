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

  // BR-39r L4 — OIDC `login_hint`: authorize forwards the hinted email as a plain `login_hint` param
  // so the login form can pre-scope the passkey challenge to the known user (advisory; passkey login
  // stays discoverable). Mirror the register page's `window.location.search` read.
  const loginParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const presetEmail = loginParams.get('login_hint') ?? undefined;

  // BR-39e Lot 6 (D17) — social federation. Buttons redirect to the IdP federation start route
  // (`GET /api/v1/auth/federation/:provider/start`); forwarding the current query preserves the
  // `continue`/`returnUrl` continuation so post-federation login resumes the OAuth flow. Google is
  // the only live provider (Lot 1); the others land as their broker lots ship.
  const federationQuery = typeof window !== 'undefined' ? window.location.search : '';
  const federationProviders = [
    { id: 'google', label: 'Google', startHref: `/api/v1/auth/federation/google/start${federationQuery}` },
  ];

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
  <AuthLogin {transport} {labels} {presetEmail} {federationProviders} onLoggedIn={handleLoggedIn}>
    <Link slot="no-account" href="/auth/register" variant="standalone">
      {labels.loginNoAccount}
    </Link>
    <Link slot="register-new-device" href="/auth/register" variant="standalone">
      {labels.loginRegisterNewDevice}
    </Link>
  </AuthLogin>
</div>
