<script lang="ts">
  import { goto } from '$app/navigation';
  import { locale } from 'svelte-i18n';
  import AuthDevices from '@sentropic/auth-ui/components/AuthDevices.svelte';
  import { createSentropicAuthTransport, resolveAuthUiLabels } from '$lib/services/auth-transport';

  const transport = createSentropicAuthTransport({
    onUnauthorized: () => goto('/auth/login?returnUrl=/auth/devices'),
  });
  $: labels = resolveAuthUiLabels($locale);

  function formatDate(iso: string): string {
    const tag = ($locale ?? 'fr').startsWith('en') ? 'en-US' : 'fr-FR';
    return new Intl.DateTimeFormat(tag).format(new Date(iso));
  }
</script>

<div class="max-w-4xl mx-auto py-8 px-4">
  <AuthDevices {transport} {labels} {formatDate}>
    <div slot="pair-cta" class="mb-6 rounded-md bg-indigo-50 p-4 flex items-center justify-between">
      <p class="text-sm text-indigo-900">{labels.devicePairSubtitle}</p>
      <a
        href="/auth/devices/pair"
        class="ml-4 shrink-0 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90"
      >
        {labels.devicePairTitle}
      </a>
    </div>
    <a slot="register-device" href="/auth/register" class="font-medium text-indigo-600 hover:text-indigo-500">
      {labels.devicesRegister}
    </a>
    <a slot="add-device" href="/auth/register" class="font-medium text-indigo-600 hover:text-indigo-500">
      {labels.devicesAddNew}
    </a>
  </AuthDevices>
</div>
