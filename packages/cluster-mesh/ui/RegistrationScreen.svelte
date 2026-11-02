<script lang="ts">
  import AuthRegister from '@sentropic/auth-ui/components/AuthRegister.svelte';
  import { completeIdentityAuth, registrationScreenTransport, type IdentityAuthScreenPorts } from './auth-flow.js';
  export let ports: IdentityAuthScreenPorts;
  $: transport = registrationScreenTransport(ports);
</script>

<AuthRegister {transport} labels={ports.labels} presetEmail={ports.presentation.email}
  presetVerificationToken={ports.presentation.verificationToken}
  skipEmailVerification={Boolean(ports.presentation.verificationToken)}
  onRegistered={session => completeIdentityAuth(ports, session)}>
  <a slot="login-link" href={ports.loginHref} class="text-primary focus-visible:ring-2 focus-visible:ring-primary/30">
    {ports.labels.registerAlreadyHaveAccount}
  </a>
</AuthRegister>
