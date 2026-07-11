<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthRegister from '@sentropic/auth-ui/components/AuthRegister.svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { locale } from '$lib/locale';
  import { createIdpAuthTransport, resolveAuthUiLabels } from '$lib/auth-transport';
  import { resolveOAuthAuthorizeContinuationUrl } from '$lib/oauth-transport';

  const transport = createIdpAuthTransport();
  let labels = $derived(resolveAuthUiLabels($locale));

  // BR-39r L4: invitation → device-enrollment deep link. authorize forwards `login_hint`
  // (→ presetEmail) and `sentropic_invite_token` (→ presetVerificationToken) as plain params,
  // with the sealed OAuth request in `continue`. A valid invite is proof-of-email → skip the
  // email-code step (`skipEmailVerification`).
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const presetEmail = params.get('login_hint') ?? undefined;
  const presetVerificationToken = params.get('sentropic_invite_token') ?? undefined;
  const skipEmailVerification = Boolean(presetVerificationToken);

  // BR-39e Lot 6 (D17) — social federation. Same start route as login; on an unknown provider
  // identity this enrolls a new account (auto-link into a non-credentialed shell per D7/D8 for
  // Google). Forwarding the query preserves the OAuth `continue` so invited RP flows resume.
  const federationQuery = typeof window !== 'undefined' ? window.location.search : '';
  const federationProviders = [
    { id: 'google', label: 'Google', startHref: `/api/v1/auth/federation/google/start${federationQuery}` },
  ];

  async function handleRegistered(_session: AuthUiSession): Promise<void> {
    // Mirror the login page: after enrollment, RESUME the OAuth continuation so an invited user
    // returns to the RP. Without this the invited RP flow would dead-end on the IdP.
    const oauthContinuation = params.get('continue');
    if (oauthContinuation) {
      window.location.assign(resolveOAuthAuthorizeContinuationUrl(oauthContinuation));
      return;
    }
    setTimeout(() => {
      void goto('/auth/signed-in');
    }, 2000);
  }
</script>

<div class="flex items-center justify-center px-4 pb-16 pt-6">
  <AuthRegister
    {transport}
    {labels}
    {presetEmail}
    {presetVerificationToken}
    {skipEmailVerification}
    {federationProviders}
    onRegistered={handleRegistered}
  >
    <a slot="login-link" href="/auth/login" class="font-medium text-primary hover:opacity-80">
      {labels.registerAlreadyHaveAccount}
    </a>
  </AuthRegister>
</div>
