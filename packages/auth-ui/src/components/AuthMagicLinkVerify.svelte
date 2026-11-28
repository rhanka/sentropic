<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, Button, Typography } from '@sentropic/design-system-svelte';
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
    /** Optional callback the host can use to drive its own redirect (e.g. to /dashboard or continueUrl). */
    onRedirect?: (session: AuthUiSession) => void;
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

  let token = $state<string | null>(null);
  let loading = $state(false);
  let success = $state(false);
  let error = $state('');

  onMount(() => {
    const rawToken = tokenSource()?.trim();
    if (!rawToken) {
      const missing = createAuthUiError('invalid_input', resolvedLabels.magicLinkErrorMissingToken);
      error = missing.message;
      onError?.(missing);
      return;
    }
    token = rawToken;
  });

  async function handleConfirm(): Promise<void> {
    if (!token || loading || success) return;
    loading = true;
    error = '';

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
      if (redirectDelayMs <= 0) {
        onRedirect(result.value);
      } else {
        setTimeout(() => onRedirect?.(result.value), redirectDelayMs);
      }
    }
  }
</script>

<div class="auth-ui-magic-link">
  <header class="auth-ui-header">
    <Typography variant="h2" align="center">
      {loading || success || error ? resolvedLabels.magicLinkTitle : resolvedLabels.magicLinkConfirmTitle}
    </Typography>
  </header>

  {#if loading && !error}
    <div class="auth-ui-loading" role="status">
      <div class="auth-ui-spinner" aria-hidden="true"></div>
      <Typography variant="body-sm" tone="muted" align="center">{resolvedLabels.magicLinkVerifying}</Typography>
    </div>
  {:else if success}
    <Alert tone="success" title={resolvedLabels.magicLinkSuccessTitle} message={resolvedLabels.redirectingDashboard} />
  {:else if error}
    <Alert tone="error" title={resolvedLabels.magicLinkErrorTitle} message={error} />
    <div class="auth-ui-actions">
      <slot name="back-to-login">
        <Typography variant="body-sm" tone="muted">{resolvedLabels.magicLinkBackToLogin}</Typography>
      </slot>
    </div>
  {:else if token}
    <div class="auth-ui-confirm">
      <Typography variant="body-sm" tone="muted" align="center">
        {resolvedLabels.magicLinkConfirmDescription}
      </Typography>
      <Button variant="primary" type="button" onclick={handleConfirm} disabled={loading}>
        {resolvedLabels.magicLinkConfirmButton}
      </Button>
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
  }
  .auth-ui-header {
    text-align: center;
  }
  .auth-ui-confirm {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    text-align: center;
  }
  .auth-ui-loading {
    text-align: center;
  }
  .auth-ui-spinner {
    display: inline-block;
    width: 3rem;
    height: 3rem;
    border: 2px solid transparent;
    border-bottom-color: var(--st-color-primary, #4f46e5);
    border-radius: 50%;
    animation: auth-ui-spin 0.75s linear infinite;
    margin-bottom: 1rem;
  }
  @keyframes auth-ui-spin {
    to { transform: rotate(360deg); }
  }
  .auth-ui-actions {
    text-align: center;
  }
</style>
