<script lang="ts">
  import { _ } from 'svelte-i18n';
  import AdminUsersScreen from '@sentropic/cluster-mesh/ui/AdminUsersScreen.svelte';
  import { session } from '$lib/stores/session';
  import { createSentropicIdentityManagementPorts } from '$lib/services/cm-identity-screens';
  export let embeddedTitle: string | null = null;
  $: ports = createSentropicIdentityManagementPorts($session.user, (key, options) => $_(key, options), message => confirm(message));
</script>

<AdminUsersScreen {ports} {embeddedTitle} />
