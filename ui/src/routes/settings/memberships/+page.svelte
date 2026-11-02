<script lang="ts">
  import { _ } from 'svelte-i18n';
  import MembershipDecisionsScreen from '@sentropic/cluster-mesh/ui/MembershipDecisionsScreen.svelte';
  import { session } from '$lib/stores/session';
  import { createSentropicIdentityManagementPorts } from '$lib/services/cm-identity-screens';
  $: ports = createSentropicIdentityManagementPorts($session.user, (key, options) => $_(key, options), message => confirm(message));
</script>

<MembershipDecisionsScreen {ports} />
