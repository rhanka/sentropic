<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import AuthLogin from '@sentropic/auth-ui/components/AuthLogin.svelte';
  import { Link, Typography } from '@sentropic/design-system-svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { locale } from '$lib/locale';
  import { createIdpAuthTransport, resolveAuthUiLabels } from '$lib/auth-transport';
  import {
    buildAuthForwardQuery,
    fetchOAuthLoginPolicy,
    resolveOAuthAuthorizeContinuationUrl,
    resolveSafeReturnUrl,
  } from '$lib/oauth-transport';

  const transport = createIdpAuthTransport();
  let labels = $derived(resolveAuthUiLabels($locale));

  // BR-39r L4 — OIDC `login_hint`: authorize forwards the hinted email as a plain `login_hint` param
  // so the login form can pre-scope the passkey challenge (or pre-fill the magic-link email).
  const initialSearch = typeof window !== 'undefined' ? window.location.search : '';
  const loginParams = new URLSearchParams(initialSearch);
  const presetEmail = loginParams.get('login_hint') ?? undefined;
  const oauthContinuation = loginParams.get('continue') ?? undefined;
  const returnUrlParam = loginParams.get('returnUrl') ?? undefined;
  const registerHref = `/auth/register${buildAuthForwardQuery(initialSearch)}`;

  let policyReady = $state(!oauthContinuation);
  let magicLinkSignIn = $state(false);

  onMount(async () => {
    if (!oauthContinuation) return;
    const policy = await fetchOAuthLoginPolicy(oauthContinuation);
    magicLinkSignIn = policy.magicLinkSignIn;
    policyReady = true;
  });

  // BR-39e Lot 6 (D17) — social federation. Buttons redirect to the IdP federation start route
  // (`GET /api/v1/auth/federation/:provider/start`); forwarding the current query preserves the
  // `continue`/`returnUrl` continuation so post-federation login resumes the OAuth flow.
  const federationProviders = [
    { id: 'google', label: 'Google', startHref: `/api/v1/auth/federation/google/start${initialSearch}` },
  ];

  // Same continuation contract as the product `ui/` login screen: after a
  // successful login the IdP resumes the OAuth authorize flow (`continue`) it
  // was redirected away from, or honours a plain `returnUrl`. The session
  // cookie is set same-origin by @sentropic/auth-hono — no SPA session store.
  async function handleLoggedIn(_session: AuthUiSession): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const continuation = params.get('continue');
    if (continuation) {
      window.location.assign(resolveOAuthAuthorizeContinuationUrl(continuation));
      return;
    }
    const returnUrl = resolveSafeReturnUrl(params.get('returnUrl'));
    await goto(returnUrl);
  }
</script>

<div class="flex items-center justify-center px-4 pb-16 pt-6">
  {#if !policyReady}
    <div class="py-12 text-center" role="status">
      <Typography variant="body-sm" tone="muted">{labels.loading}</Typography>
    </div>
  {:else}
    <AuthLogin
      {transport}
      {labels}
      {presetEmail}
      {federationProviders}
      {magicLinkSignIn}
      {oauthContinuation}
      returnUrl={returnUrlParam}
      onLoggedIn={handleLoggedIn}
    >
      <Link slot="no-account" href={registerHref} variant="standalone">
        {labels.loginNoAccount}
      </Link>
      <Link slot="register-new-device" href={registerHref} variant="standalone">
        {labels.loginRegisterNewDevice}
      </Link>
    </AuthLogin>
  {/if}
</div>
