<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { locale } from 'svelte-i18n';
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
  <AuthDevicePair {transport} {labels} {userCodeSource}>
    <a slot="back-to-devices" href="/auth/devices" class="font-medium text-indigo-600 hover:text-indigo-500">
      {labels.devicePairBack}
    </a>
    <a slot="cancel" href="/auth/devices" class="text-sm text-gray-600 hover:text-gray-800">
      {labels.devicePairBack}
    </a>
  </AuthDevicePair>
</div>
