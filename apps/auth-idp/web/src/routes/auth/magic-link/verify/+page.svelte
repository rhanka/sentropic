<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import AuthMagicLinkVerify from '@sentropic/auth-ui/components/AuthMagicLinkVerify.svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { locale } from '$lib/locale';
  import { createIdpAuthTransport, resolveAuthUiLabels } from '$lib/auth-transport';

  const transport = createIdpAuthTransport();
  let labels = $derived(resolveAuthUiLabels($locale));

  function tokenSource(): string | null {
    return $page.url.searchParams.get('token');
  }

  async function handleVerified(_session: AuthUiSession): Promise<void> {
    // Session cookie is set same-origin by @sentropic/auth-hono.
  }

  function handleRedirect(): void {
    void goto('/auth/signed-in');
  }
</script>

<div class="flex items-center justify-center px-4 pb-16 pt-6">
  <AuthMagicLinkVerify
    {transport}
    {labels}
    {tokenSource}
    onVerified={handleVerified}
    onRedirect={handleRedirect}
  >
    <a slot="back-to-login" href="/auth/login" class="font-medium text-primary hover:opacity-80">
      {labels.magicLinkBackToLogin}
    </a>
  </AuthMagicLinkVerify>
</div>
