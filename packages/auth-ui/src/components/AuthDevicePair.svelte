<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createDefaultAuthUiLabels,
    type AuthUiError,
    type AuthUiLabels,
    type AuthUiTransport,
  } from '../contracts.js';

  interface Props {
    transport: AuthUiTransport;
    labels?: Partial<AuthUiLabels>;
    /** Optional source for an initial user code (e.g. from `?user_code=PAIR-XXXX`). */
    userCodeSource?: () => string | null | undefined;
    onPaired?: (deviceName?: string) => void | Promise<void>;
    onError?: (error: AuthUiError) => void;
  }

  let { transport, labels, userCodeSource, onPaired, onError }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));

  let userCode = $state('');
  let deviceName = $state('');
  let submitting = $state(false);
  let error = $state('');
  let success = $state(false);
  let pairedDeviceName = $state<string | undefined>(undefined);

  onMount(() => {
    const initial = userCodeSource?.();
    if (initial) {
      userCode = initial.toUpperCase();
    }
  });

  async function pair(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    error = '';
    const code = userCode.trim().toUpperCase();
    if (!code) {
      error = resolvedLabels.devicePairErrorCodeRequired;
      return;
    }

    submitting = true;
    const result = await transport.approveDevicePairing({
      userCode: code,
      deviceName: deviceName.trim() || undefined,
    });
    submitting = false;

    if (!result.ok) {
      const message = result.error.message || resolvedLabels.devicePairErrorGeneric;
      const looksLikeNotFound = /not[\s-]?found|expired|invalid/i.test(message);
      error = looksLikeNotFound ? resolvedLabels.devicePairErrorNotFound : message;
      onError?.(result.error);
      return;
    }

    success = true;
    pairedDeviceName = result.value.deviceName;
    await onPaired?.(pairedDeviceName);
  }
</script>

<div class="auth-ui-device-pair">
  <header class="auth-ui-header">
    <h1 class="auth-ui-title">{resolvedLabels.devicePairTitle}</h1>
    <p class="auth-ui-subtitle">{resolvedLabels.devicePairSubtitle}</p>
  </header>

  {#if error}
    <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
  {/if}

  {#if success}
    <div class="auth-ui-alert auth-ui-alert--success" role="status">
      {resolvedLabels.devicePairSuccess}
    </div>
    <div class="auth-ui-actions">
      <slot name="back-to-devices">
        <span class="auth-ui-link">{resolvedLabels.devicePairBack}</span>
      </slot>
    </div>
  {:else}
    <form class="auth-ui-form" onsubmit={pair}>
      <div class="auth-ui-field">
        <label for="auth-ui-pair-code" class="auth-ui-label">
          {resolvedLabels.devicePairCodeLabel}
        </label>
        <input
          id="auth-ui-pair-code"
          type="text"
          bind:value={userCode}
          oninput={() => (userCode = userCode.toUpperCase())}
          placeholder={resolvedLabels.devicePairCodePlaceholder}
          autocomplete="off"
          class="auth-ui-input auth-ui-input--mono"
        />
      </div>

      <div class="auth-ui-field">
        <label for="auth-ui-pair-device-name" class="auth-ui-label">
          {resolvedLabels.devicePairDeviceNameLabel}
        </label>
        <input
          id="auth-ui-pair-device-name"
          type="text"
          bind:value={deviceName}
          placeholder={resolvedLabels.devicePairDeviceNamePlaceholder}
          autocomplete="off"
          class="auth-ui-input"
        />
      </div>

      <div class="auth-ui-form-actions">
        <button
          type="submit"
          disabled={submitting}
          class="auth-ui-button auth-ui-button--primary"
        >
          {submitting ? resolvedLabels.devicePairConfirming : resolvedLabels.devicePairConfirm}
        </button>
        <slot name="cancel">
          <span class="auth-ui-link auth-ui-link--secondary">{resolvedLabels.devicePairBack}</span>
        </slot>
      </div>
    </form>
  {/if}
</div>

<style>
  .auth-ui-device-pair {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 28rem;
    margin: 0 auto;
    padding: 2rem 1rem;
    font-family: var(--auth-font-family, system-ui, -apple-system, sans-serif);
    color: var(--auth-text, #111827);
  }
  .auth-ui-header { display: flex; flex-direction: column; gap: 0.5rem; }
  .auth-ui-title { margin: 0; font-size: 1.5rem; font-weight: 700; }
  .auth-ui-subtitle { margin: 0; font-size: 0.875rem; color: var(--auth-muted, #6b7280); }
  .auth-ui-alert {
    padding: 0.75rem 1rem;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-alert--error { background: var(--auth-error-bg, #fef2f2); color: var(--auth-error-text, #991b1b); }
  .auth-ui-alert--success { background: var(--auth-success-bg, #f0fdf4); color: var(--auth-success-text, #166534); }
  .auth-ui-form { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; background: var(--auth-surface, #ffffff); border-radius: var(--auth-radius-lg, 0.5rem); box-shadow: var(--auth-shadow, 0 1px 2px rgba(0,0,0,0.05)); }
  .auth-ui-field { display: flex; flex-direction: column; gap: 0.375rem; }
  .auth-ui-label { font-size: 0.875rem; font-weight: 500; color: var(--auth-text, #111827); }
  .auth-ui-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--auth-border, #d1d5db);
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-input:focus { outline: none; border-color: var(--auth-primary, #4f46e5); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15); }
  .auth-ui-input--mono { font-family: var(--auth-mono, ui-monospace, "SFMono-Regular", monospace); letter-spacing: 0.15em; text-transform: uppercase; }
  .auth-ui-form-actions { display: flex; align-items: center; gap: 0.75rem; padding-top: 0.5rem; }
  .auth-ui-button { padding: 0.5rem 1rem; border: none; border-radius: var(--auth-radius, 0.375rem); font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .auth-ui-button:disabled { opacity: 0.5; cursor: not-allowed; }
  .auth-ui-button--primary { background: var(--auth-primary, #4f46e5); color: var(--auth-primary-text, #ffffff); }
  .auth-ui-link { color: var(--auth-link, #4f46e5); font-size: 0.875rem; font-weight: 500; text-decoration: none; cursor: pointer; }
  .auth-ui-link--secondary { color: var(--auth-link-secondary, #6b7280); }
  .auth-ui-link:hover { text-decoration: underline; }
  .auth-ui-actions { text-align: center; }
</style>
