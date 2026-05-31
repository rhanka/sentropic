<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createDefaultAuthUiLabels,
    isWebAuthnSupported,
    startPasskeyAuthentication,
    getWebAuthnErrorMessage,
    type AuthUiError,
    type AuthUiLabels,
    type AuthUiSession,
    type AuthUiTransport,
  } from '../contracts.js';

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
    <h2 class="auth-ui-title">{resolvedLabels.loginTitle}</h2>
    <p class="auth-ui-subtitle">
      {webauthnSupported ? resolvedLabels.loginSupportedHint : resolvedLabels.loginUnavailable}
    </p>
  </header>

  {#if !webauthnSupported}
    <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
  {:else if !showLostDevice}
    <div class="auth-ui-section">
      {#if error}
        <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
      {/if}
      <button
        type="button"
        class="auth-ui-button auth-ui-button--primary"
        onclick={handleLogin}
        disabled={loading}
      >
        {loading ? resolvedLabels.loginButtonLoading : resolvedLabels.loginButton}
      </button>
      <div class="auth-ui-actions">
        <button type="button" class="auth-ui-link" onclick={handleLostDevice}>
          {resolvedLabels.loginLostDevice}
        </button>
      </div>
      <div class="auth-ui-actions">
        <slot name="no-account">
          <span class="auth-ui-link">{resolvedLabels.loginNoAccount}</span>
        </slot>
      </div>
    </div>
  {:else}
    <div class="auth-ui-section">
      <div class="auth-ui-alert auth-ui-alert--info" role="status">
        <h3 class="auth-ui-alert__title">{resolvedLabels.loginLostDeviceTitle}</h3>
        <p>{resolvedLabels.webauthnRegisterNotice}</p>
      </div>
      <div class="auth-ui-actions">
        <slot name="register-new-device">
          <span class="auth-ui-link">{resolvedLabels.loginRegisterNewDevice}</span>
        </slot>
      </div>
      <div class="auth-ui-actions">
        <button type="button" class="auth-ui-link auth-ui-link--secondary" onclick={() => (showLostDevice = false)}>
          {resolvedLabels.loginBackToLogin}
        </button>
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
    font-family: var(--auth-font-family, system-ui, -apple-system, sans-serif);
    color: var(--auth-text, #111827);
  }
  .auth-ui-header {
    text-align: center;
  }
  .auth-ui-title {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 700;
  }
  .auth-ui-subtitle {
    margin: 0;
    font-size: 0.875rem;
    color: var(--auth-muted, #6b7280);
  }
  .auth-ui-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .auth-ui-actions {
    text-align: center;
  }
  .auth-ui-alert {
    padding: 0.75rem 1rem;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-alert--error {
    background: var(--auth-error-bg, #fef2f2);
    color: var(--auth-error-text, #991b1b);
  }
  .auth-ui-alert--info {
    background: var(--auth-info-bg, #eff6ff);
    color: var(--auth-info-text, #1e3a8a);
  }
  .auth-ui-alert__title {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .auth-ui-button {
    width: 100%;
    padding: 0.625rem 1rem;
    border: none;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  .auth-ui-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .auth-ui-button--primary {
    background: var(--auth-primary, #4f46e5);
    color: var(--auth-primary-text, #ffffff);
  }
  .auth-ui-button--primary:hover:not(:disabled) {
    background: var(--auth-primary-hover, #4338ca);
  }
  .auth-ui-link {
    background: none;
    border: none;
    color: var(--auth-link, #4f46e5);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }
  .auth-ui-link:hover {
    text-decoration: underline;
  }
  .auth-ui-link--secondary {
    color: var(--auth-link-secondary, #6b7280);
  }
</style>
