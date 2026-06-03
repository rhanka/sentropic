<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { _, locale } from 'svelte-i18n';
  import AuthDevicePair from '@sentropic/auth-ui/components/AuthDevicePair.svelte';
  import { createSentropicAuthTransport, resolveAuthUiLabels } from '$lib/services/auth-transport';

  const transport = createSentropicAuthTransport({
    onUnauthorized: () => goto('/auth/login?returnUrl=/auth/devices/pair'),
  });
  $: labels = resolveAuthUiLabels($locale);

  function userCodeSource(): string | null {
    return $page.url.searchParams.get('user_code');
  }
</script>

<div class="max-w-md mx-auto py-8 px-4">
  <div class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4" role="alert">
    <p class="text-sm font-semibold text-amber-900">{$_('coworkPairing.confirmTitle')}</p>
    <p class="mt-1 text-sm text-amber-800">{$_('coworkPairing.confirmBody')}</p>
  </div>
  <AuthDevicePair {transport} {labels} {userCodeSource}>
    <a slot="back-to-devices" href="/auth/devices" class="font-medium text-indigo-600 hover:text-indigo-500">
      {labels.devicePairBack}
    </a>
    <a slot="cancel" href="/auth/devices" class="text-sm text-gray-600 hover:text-gray-800">
      {labels.devicePairBack}
    </a>
  </AuthDevicePair>
</div>
