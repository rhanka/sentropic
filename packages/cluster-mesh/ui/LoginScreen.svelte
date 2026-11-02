<script lang="ts">
  import AuthLogin from '@sentropic/auth-ui/components/AuthLogin.svelte';
  import { completeIdentityAuth, type IdentityAuthScreenPorts } from './auth-flow.js';
  export let ports: IdentityAuthScreenPorts;
</script>

<AuthLogin transport={ports.transport} labels={ports.labels} presetEmail={ports.presentation.email}
  onLoggedIn={session => completeIdentityAuth(ports, session)}>
  <a slot="no-account" href={ports.registerHref} class="text-primary focus-visible:ring-2 focus-visible:ring-primary/30">
    {ports.labels.loginNoAccount}
  </a>
  <a slot="register-new-device" href={ports.registerHref} class="text-primary focus-visible:ring-2 focus-visible:ring-primary/30">
    {ports.labels.loginRegisterNewDevice}
  </a>
</AuthLogin>
