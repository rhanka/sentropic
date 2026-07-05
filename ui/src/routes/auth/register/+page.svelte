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
  import { resolveOAuthAuthorizeContinuationUrl } from '$lib/services/oauth-transport';

  const transport = createSentropicAuthTransport();
  $: labels = resolveAuthUiLabels($locale);

  // BR-39r L4: invitation → device-enrollment deep link. authorize forwards `login_hint`
  // (→ presetEmail) and `sentropic_invite_token` (→ presetVerificationToken) as plain params,
  // with the sealed OAuth request in `continue`. A valid invite is proof-of-email → skip the
  // email-code step (`skipEmailVerification`).
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const presetEmail = params.get('login_hint') ?? undefined;
  const presetVerificationToken = params.get('sentropic_invite_token') ?? undefined;
  const skipEmailVerification = Boolean(presetVerificationToken);

  async function handleRegistered(session: AuthUiSession): Promise<void> {
    setUser(toSentropicUser(session.user));
    if (session.sessionToken) {
      sessionStorage.setItem('sessionToken', session.sessionToken);
    }
    if (session.refreshToken) {
      sessionStorage.setItem('refreshToken', session.refreshToken);
    }
    // Mirror the login page: after enrollment, RESUME the OAuth continuation so an invited user
    // returns to the RP. Without this the invited RP flow would dead-end on the app.
    const oauthContinuation = params.get('continue');
    if (oauthContinuation) {
      window.location.assign(resolveOAuthAuthorizeContinuationUrl(oauthContinuation));
      return;
    }
    setTimeout(() => {
      goto('/neutral');
    }, 2000);
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
  <AuthRegister
    {transport}
    {labels}
    {presetEmail}
    {presetVerificationToken}
    {skipEmailVerification}
    onRegistered={handleRegistered}
  >
    <a slot="login-link" href="/auth/login" class="font-medium text-indigo-600 hover:text-indigo-500">
      {labels.registerAlreadyHaveAccount}
    </a>
  </AuthRegister>
</div>
