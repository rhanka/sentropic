<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, Button, Card, Input, Typography } from '@sentropic/design-system-svelte';
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
    <Typography variant="h1">{resolvedLabels.devicePairTitle}</Typography>
    <Typography variant="body-sm" tone="muted">{resolvedLabels.devicePairSubtitle}</Typography>
  </header>

  {#if error}
    <Alert tone="error" title={error} />
  {/if}

  {#if success}
    <Alert tone="success" title={resolvedLabels.devicePairSuccess} />
    <div class="auth-ui-actions">
      <slot name="back-to-devices">
        <Typography variant="body-sm" tone="muted">{resolvedLabels.devicePairBack}</Typography>
      </slot>
    </div>
  {:else}
    <Card>
      <form class="auth-ui-form" onsubmit={pair}>
        <Input
          id="auth-ui-pair-code"
          label={resolvedLabels.devicePairCodeLabel}
          type="text"
          bind:value={userCode}
          oninput={() => (userCode = userCode.toUpperCase())}
          placeholder={resolvedLabels.devicePairCodePlaceholder}
          autocomplete="off"
          class="auth-ui-input--mono"
        />

        <Input
          id="auth-ui-pair-device-name"
          label={resolvedLabels.devicePairDeviceNameLabel}
          type="text"
          bind:value={deviceName}
          placeholder={resolvedLabels.devicePairDeviceNamePlaceholder}
          autocomplete="off"
        />

        <div class="auth-ui-form-actions">
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? resolvedLabels.devicePairConfirming : resolvedLabels.devicePairConfirm}
          </Button>
          <slot name="cancel">
            <Typography variant="body-sm" tone="muted">{resolvedLabels.devicePairBack}</Typography>
          </slot>
        </div>
      </form>
    </Card>
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
  }
  .auth-ui-header { display: flex; flex-direction: column; gap: 0.5rem; }
  .auth-ui-form { display: flex; flex-direction: column; gap: 1rem; }
  .auth-ui-form-actions { display: flex; align-items: center; gap: 0.75rem; padding-top: 0.5rem; }
  :global(.auth-ui-input--mono input) {
    font-family: var(--st-font-mono, ui-monospace, "SFMono-Regular", monospace);
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .auth-ui-actions { text-align: center; }
</style>
