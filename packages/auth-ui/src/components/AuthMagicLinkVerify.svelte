<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createAuthUiError,
    createDefaultAuthUiLabels,
    type AuthUiError,
    type AuthUiLabels,
    type AuthUiSession,
    type AuthUiTransport,
  } from '../contracts.js';

  interface Props {
    transport: AuthUiTransport;
    labels?: Partial<AuthUiLabels>;
    /** Function the host supplies to read the token from its router/URL. */
    tokenSource: () => string | null | undefined;
    onVerified: (session: AuthUiSession) => void | Promise<void>;
    /** Optional callback the host can use to drive its own redirect (e.g. to /dashboard). */
    onRedirect?: () => void;
    onError?: (error: AuthUiError) => void;
    /** Delay before invoking onRedirect after a successful verify. Defaults to 1000 ms. */
    redirectDelayMs?: number;
  }

  let {
    transport,
    labels,
    tokenSource,
    onVerified,
    onRedirect,
    onError,
    redirectDelayMs = 1000,
  }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));

  let loading = $state(true);
  let success = $state(false);
  let error = $state('');

  onMount(async () => {
    const token = tokenSource()?.trim();
    if (!token) {
      const missing = createAuthUiError('invalid_input', resolvedLabels.magicLinkErrorMissingToken);
      error = missing.message;
      onError?.(missing);
      loading = false;
      return;
    }

    const result = await transport.verifyMagicLink({ token });
    loading = false;

    if (!result.ok) {
      error = result.error.message || resolvedLabels.magicLinkErrorVerifyFailed;
      onError?.(result.error);
      return;
    }

    success = true;
    await onVerified(result.value);
    if (onRedirect) {
      setTimeout(onRedirect, redirectDelayMs);
    }
  });
</script>

<div class="auth-ui-magic-link">
  <header class="auth-ui-header">
    <h2 class="auth-ui-title">{resolvedLabels.magicLinkTitle}</h2>
  </header>

  {#if loading && !error}
    <div class="auth-ui-loading" role="status">
      <div class="auth-ui-spinner" aria-hidden="true"></div>
      <p class="auth-ui-loading__label">{resolvedLabels.magicLinkVerifying}</p>
    </div>
  {:else if success}
    <div class="auth-ui-alert auth-ui-alert--success" role="status">
      <h3 class="auth-ui-alert__title">{resolvedLabels.magicLinkSuccessTitle}</h3>
      <p>{resolvedLabels.redirectingDashboard}</p>
    </div>
  {:else if error}
    <div class="auth-ui-alert auth-ui-alert--error" role="alert">
      <h3 class="auth-ui-alert__title">{resolvedLabels.magicLinkErrorTitle}</h3>
      <p>{error}</p>
    </div>
    <div class="auth-ui-actions">
      <slot name="back-to-login">
        <span class="auth-ui-link">{resolvedLabels.magicLinkBackToLogin}</span>
      </slot>
    </div>
  {/if}
</div>

<style>
  .auth-ui-magic-link {
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
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
  }
  .auth-ui-loading {
    text-align: center;
  }
  .auth-ui-spinner {
    display: inline-block;
    width: 3rem;
    height: 3rem;
    border: 2px solid transparent;
    border-bottom-color: var(--auth-primary, #4f46e5);
    border-radius: 50%;
    animation: auth-ui-spin 0.75s linear infinite;
  }
  .auth-ui-loading__label {
    margin-top: 1rem;
    font-size: 0.875rem;
    color: var(--auth-muted, #6b7280);
  }
  @keyframes auth-ui-spin {
    to { transform: rotate(360deg); }
  }
  .auth-ui-alert {
    padding: 1rem;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-alert--error {
    background: var(--auth-error-bg, #fef2f2);
    color: var(--auth-error-text, #991b1b);
  }
  .auth-ui-alert--success {
    background: var(--auth-success-bg, #f0fdf4);
    color: var(--auth-success-text, #166534);
  }
  .auth-ui-alert__title {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .auth-ui-actions {
    text-align: center;
  }
  .auth-ui-link {
    color: var(--auth-link, #4f46e5);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }
  .auth-ui-link:hover {
    text-decoration: underline;
  }
</style>
