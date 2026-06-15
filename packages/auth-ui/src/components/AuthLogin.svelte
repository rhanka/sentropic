<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, Button, Typography } from '@sentropic/design-system-svelte';
  import {
    createDefaultAuthUiLabels,
    type AuthUiError,
    type AuthUiLabels,
    type AuthUiSession,
    type AuthUiTransport,
  } from '../contracts.js';
  import {
    isWebAuthnSupported,
    startPasskeyAuthentication,
    getWebAuthnErrorMessage,
  } from '../webauthn.js';

  interface Props {
    transport: AuthUiTransport;
    labels?: Partial<AuthUiLabels>;
    onLoggedIn: (session: AuthUiSession) => void | Promise<void>;
    onLostDevice?: () => void;
    onError?: (error: AuthUiError) => void;
  }

  let { transport, labels, onLoggedIn, onLostDevice, onError }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));

  let loading = $state(false);
  let error = $state('');
  let webauthnSupported = $state(false);
  let showLostDevice = $state(false);

  onMount(() => {
    webauthnSupported = isWebAuthnSupported();
    if (!webauthnSupported) {
      error = resolvedLabels.loginUnsupportedBrowser;
    }
  });

  async function handleLogin(): Promise<void> {
    loading = true;
    error = '';
    try {
      const optionsResult = await transport.createPasskeyAuthenticationOptions({});
      if (!optionsResult.ok) {
        error = optionsResult.error.message;
        onError?.(optionsResult.error);
        loading = false;
        return;
      }

      let credential;
      try {
        credential = await startPasskeyAuthentication(optionsResult.value.options);
      } catch (err) {
        const authError = err as AuthUiError;
        error = getWebAuthnErrorMessage(authError, resolvedLabels);
        onError?.(authError);
        loading = false;
        return;
      }

      const verifyResult = await transport.verifyPasskeyAuthentication({ credential });
      if (!verifyResult.ok) {
        error = verifyResult.error.message;
        onError?.(verifyResult.error);
        loading = false;
        return;
      }

      await onLoggedIn(verifyResult.value);
    } finally {
      loading = false;
    }
  }

  function handleLostDevice(): void {
    showLostDevice = true;
    onLostDevice?.();
  }
</script>

<div class="auth-ui-login">
  <header class="auth-ui-header">
    <Typography variant="h2" align="center">{resolvedLabels.loginTitle}</Typography>
    <Typography variant="body-sm" tone="muted" align="center">
      {webauthnSupported ? resolvedLabels.loginSupportedHint : resolvedLabels.loginUnavailable}
    </Typography>
  </header>

  {#if !webauthnSupported}
    <Alert tone="error" title={error} />
  {:else if !showLostDevice}
    <div class="auth-ui-section">
      {#if error}
        <Alert tone="error" title={error} />
      {/if}
      <Button variant="primary" type="button" onclick={handleLogin} disabled={loading}>
        {loading ? resolvedLabels.loginButtonLoading : resolvedLabels.loginButton}
      </Button>
      <div class="auth-ui-actions">
        <Button variant="ghost" type="button" onclick={handleLostDevice}>
          {resolvedLabels.loginLostDevice}
        </Button>
      </div>
      <div class="auth-ui-actions">
        <slot name="no-account">
          <Typography variant="body-sm" tone="muted">{resolvedLabels.loginNoAccount}</Typography>
        </slot>
      </div>
    </div>
  {:else}
    <div class="auth-ui-section">
      <Alert tone="info" title={resolvedLabels.loginLostDeviceTitle} message={resolvedLabels.webauthnRegisterNotice} />
      <div class="auth-ui-actions">
        <slot name="register-new-device">
          <Typography variant="body-sm" tone="muted">{resolvedLabels.loginRegisterNewDevice}</Typography>
        </slot>
      </div>
      <div class="auth-ui-actions">
        <Button variant="ghost" type="button" onclick={() => (showLostDevice = false)}>
          {resolvedLabels.loginBackToLogin}
        </Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .auth-ui-login {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 28rem;
    margin: 0 auto;
    padding: 2rem 1rem;
  }
  .auth-ui-header {
    text-align: center;
  }
  .auth-ui-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .auth-ui-actions {
    text-align: center;
  }
</style>
