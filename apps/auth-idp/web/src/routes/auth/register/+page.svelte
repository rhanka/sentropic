<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthRegister from '@sentropic/auth-ui/components/AuthRegister.svelte';
  import type { AuthUiSession } from '@sentropic/auth-ui';
  import { locale } from '$lib/locale';
  import { createIdpAuthTransport, resolveAuthUiLabels } from '$lib/auth-transport';

  const transport = createIdpAuthTransport();
  let labels = $derived(resolveAuthUiLabels($locale));

  async function handleRegistered(_session: AuthUiSession): Promise<void> {
    // Mirror the product `ui/` register flow: brief pause, then continue.
    setTimeout(() => {
      void goto('/auth/signed-in');
    }, 2000);
  }
</script>

<div class="flex items-center justify-center px-4 pb-16 pt-6">
  <AuthRegister {transport} {labels} onRegistered={handleRegistered}>
    <a slot="login-link" href="/auth/login" class="font-medium text-primary hover:opacity-80">
      {labels.registerAlreadyHaveAccount}
    </a>
  </AuthRegister>
</div>
