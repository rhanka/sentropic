<script lang="ts">
  import { page } from '$app/stores';
  import AuthMagicLinkVerify from '@sentropic/auth-ui/components/AuthMagicLinkVerify.svelte';
  import { Alert, Typography } from '@sentropic/design-system-svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { locale } from '$lib/locale';
  import { createIdpAuthTransport, resolveAuthUiLabels } from '$lib/auth-transport';
  import { resolveSafeReturnUrl } from '$lib/oauth-transport';

  const transport = createIdpAuthTransport();
  let labels = $derived(resolveAuthUiLabels($locale));
  let isFrench = $derived(($locale ?? 'fr').startsWith('fr'));

  let continuationUnavailable = $state(false);
  let continuationExpired = $state(false);

  let restartTitle = $derived(
    continuationExpired
      ? isFrench
        ? 'Lien de retour expiré'
        : 'Sign-in continuation expired'
      : isFrench
        ? 'Reprise de connexion introuvable'
        : 'Sign-in continuation missing',
  );

  let restartMessage = $derived(
    isFrench
      ? "Votre adresse e-mail est confirmée, mais la session de connexion avec l'application a expiré ou est introuvable. Veuillez retourner sur l'application et recommencer la connexion."
      : 'Your email is verified, but the return link to the application has expired or is missing. Please go back to the application and start sign-in again.',
  );

  function tokenSource(): string | null {
    return $page.url.searchParams.get('token');
  }

  async function handleVerified(session: AuthUiSession): Promise<void> {
    if (!session.continueUrl) {
      continuationExpired = session.continuationExpired === true;
      continuationUnavailable = true;
    }
  }

  function handleRedirect(session: AuthUiSession): void {
    if (session.continueUrl) {
      window.location.assign(resolveSafeReturnUrl(session.continueUrl));
      return;
    }
    continuationExpired = session.continuationExpired === true;
    continuationUnavailable = true;
  }
</script>

<div class="flex items-center justify-center px-4 pb-16 pt-6">
  {#if continuationUnavailable}
    <div class="mx-auto flex max-w-md flex-col gap-4 py-8 text-center" role="status">
      <Typography variant="h2" align="center">{labels.magicLinkTitle}</Typography>
      <Alert tone="warning" title={restartTitle} message={restartMessage} />
    </div>
  {:else}
    <AuthMagicLinkVerify
      {transport}
      {labels}
      {tokenSource}
      redirectDelayMs={0}
      onVerified={handleVerified}
      onRedirect={handleRedirect}
    >
      <a slot="back-to-login" href="/auth/login" class="font-medium text-primary hover:opacity-80">
        {labels.magicLinkBackToLogin}
      </a>
    </AuthMagicLinkVerify>
  {/if}
</div>
