<script lang="ts">
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import AdminUsersScreen from '@sentropic/cluster-mesh/ui/AdminUsersScreen.svelte';
  import { createIdentityManagementTransport } from '@sentropic/cluster-mesh/ui/management';
  import { session } from '$lib/stores/session';
  import { addToast } from '$lib/stores/toast';
  import { apiFetch } from '$lib/utils/api';
  export let embeddedTitle: string | null = null;
  const transport = createIdentityManagementTransport(apiFetch);
  $: ports = { userId: $session.user?.id ?? null, role: $session.user?.role ?? null, transport,
    text: (key: string, options?: { values?: Record<string, string> }) => get(_)(key, options),
    notify: addToast, confirm: (message: string) => confirm(message), operationId: () => crypto.randomUUID() };
</script>

<AdminUsersScreen {ports} {embeddedTitle} />
