<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, Button, Input, Typography } from '@sentropic/design-system-svelte';
  import {
    createDefaultAuthUiLabels,
    type AuthUiCredential,
    type AuthUiError,
    type AuthUiLabels,
    type AuthUiTransport,
  } from '../contracts.js';

  interface Props {
    transport: AuthUiTransport;
    labels?: Partial<AuthUiLabels>;
    /** Host-controlled date formatter; defaults to ISO date. */
    formatDate?: (iso: string) => string;
    /** Async confirmation hook so hosts can render a modal instead of `window.confirm`. */
    confirmRevoke?: (message: string) => boolean | Promise<boolean>;
    onUnauthorized?: () => void;
    onError?: (error: AuthUiError) => void;
  }

  let {
    transport,
    labels,
    formatDate = defaultFormatDate,
    confirmRevoke = defaultConfirm,
    onUnauthorized,
    onError,
  }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));

  let credentials = $state<AuthUiCredential[]>([]);
  let loading = $state(true);
  let error = $state('');
  let editingId = $state<string | null>(null);
  let editingName = $state('');

  function defaultFormatDate(iso: string): string {
    return iso.slice(0, 10);
  }

  function defaultConfirm(message: string): boolean {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.confirm(message);
  }

  function formatTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  }

  onMount(loadCredentials);

  async function loadCredentials(): Promise<void> {
    loading = true;
    error = '';
    const result = await transport.listCredentials();
    loading = false;
    if (!result.ok) {
      handleError(result.error, resolvedLabels.devicesErrorLoad);
      return;
    }
    credentials = result.value.credentials;
  }

  function startEdit(credential: AuthUiCredential): void {
    editingId = credential.id;
    editingName = credential.deviceName;
  }

  function cancelEdit(): void {
    editingId = null;
    editingName = '';
  }

  async function saveDeviceName(credential: AuthUiCredential): Promise<void> {
    const result = await transport.renameCredential({
      credentialId: credential.id,
      deviceName: editingName,
    });
    if (!result.ok) {
      handleError(result.error, resolvedLabels.devicesErrorUpdate);
      return;
    }
    editingId = null;
    editingName = '';
    await loadCredentials();
  }

  async function revoke(credential: AuthUiCredential): Promise<void> {
    const message = formatTemplate(resolvedLabels.devicesConfirmRevoke, {
      deviceName: credential.deviceName,
    });
    const confirmed = await confirmRevoke(message);
    if (!confirmed) {
      return;
    }
    const result = await transport.revokeCredential({ credentialId: credential.id });
    if (!result.ok) {
      handleError(result.error, resolvedLabels.devicesErrorRevoke);
      return;
    }
    await loadCredentials();
  }

  function handleError(err: AuthUiError, fallback: string): void {
    error = err.message || fallback;
    if (err.code === 'transport_error' && err.message.toLowerCase().includes('unauth')) {
      onUnauthorized?.();
    }
    onError?.(err);
  }
</script>

<div class="auth-ui-devices">
  <header class="auth-ui-header">
    <Typography variant="h1">{resolvedLabels.devicesTitle}</Typography>
    <Typography variant="body-sm" tone="muted">{resolvedLabels.devicesSubtitle}</Typography>
  </header>

  {#if error}
    <Alert tone="error" title={error} />
  {/if}

  <slot name="pair-cta">
    <div class="auth-ui-cta">
      <Typography variant="body-sm">{resolvedLabels.devicePairSubtitle}</Typography>
      <Button variant="primary" type="button">{resolvedLabels.devicePairTitle}</Button>
    </div>
  </slot>

  {#if loading}
    <div class="auth-ui-loading" role="status">
      <div class="auth-ui-spinner" aria-hidden="true"></div>
      <Typography variant="body-sm" tone="muted" align="center">{resolvedLabels.loading}</Typography>
    </div>
  {:else if credentials.length === 0}
    <div class="auth-ui-empty">
      <Typography variant="body" tone="muted" align="center">{resolvedLabels.devicesEmpty}</Typography>
      <slot name="register-device">
        <Button variant="primary" type="button">{resolvedLabels.devicesRegister}</Button>
      </slot>
    </div>
  {:else}
    <ul class="auth-ui-list">
      {#each credentials as credential (credential.id)}
        <li class="auth-ui-list__item">
          <div class="auth-ui-list__primary">
            {#if editingId === credential.id}
              <div class="auth-ui-edit">
                <Input
                  type="text"
                  bind:value={editingName}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      void saveDeviceName(credential);
                    } else if (e.key === 'Escape') {
                      cancelEdit();
                    }
                  }}
                />
                <Button variant="primary" size="sm" type="button" onclick={() => saveDeviceName(credential)}>
                  {resolvedLabels.save}
                </Button>
                <Button variant="ghost" size="sm" type="button" onclick={cancelEdit}>
                  {resolvedLabels.cancel}
                </Button>
              </div>
            {:else}
              <Typography variant="h5" as="h3">{credential.deviceName}</Typography>
            {/if}
            <div class="auth-ui-list__meta">
              <span>{formatTemplate(resolvedLabels.devicesAddedOn, { date: formatDate(credential.createdAt) })}</span>
              {#if credential.lastUsedAt}
                <span>{formatTemplate(resolvedLabels.devicesLastUsed, { date: formatDate(credential.lastUsedAt) })}</span>
              {/if}
              {#if credential.uv}
                <span class="auth-ui-badge">{resolvedLabels.devicesUvEnabled}</span>
              {/if}
            </div>
          </div>
          {#if editingId !== credential.id}
            <div class="auth-ui-list__actions">
              <Button variant="ghost" size="sm" type="button" onclick={() => startEdit(credential)}>
                {resolvedLabels.devicesRename}
              </Button>
              <Button variant="danger" size="sm" type="button" onclick={() => revoke(credential)}>
                {resolvedLabels.devicesRevoke}
              </Button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="auth-ui-actions">
      <slot name="add-device">
        <Typography variant="body-sm" tone="muted">{resolvedLabels.devicesAddNew}</Typography>
      </slot>
    </div>
  {/if}
</div>

<style>
  .auth-ui-devices {
    display: flex; flex-direction: column; gap: 1.5rem;
    max-width: 48rem; margin: 0 auto; padding: 2rem 1rem;
  }
  .auth-ui-header { display: flex; flex-direction: column; gap: 0.5rem; }
  .auth-ui-cta {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: 1rem;
    background: var(--st-color-surface-subtle, #eef2ff);
    border-radius: var(--st-radius, 0.375rem);
  }
  .auth-ui-loading { text-align: center; padding: 3rem 0; }
  .auth-ui-spinner {
    display: inline-block; width: 3rem; height: 3rem;
    border: 2px solid transparent;
    border-bottom-color: var(--st-color-primary, #4f46e5);
    border-radius: 50%; animation: auth-ui-spin 0.75s linear infinite;
    margin-bottom: 1rem;
  }
  @keyframes auth-ui-spin { to { transform: rotate(360deg); } }
  .auth-ui-empty {
    display: flex; flex-direction: column; align-items: center; gap: 1rem;
    padding: 3rem 1rem;
    background: var(--st-color-surface, #ffffff);
    border-radius: var(--st-radius-lg, 0.5rem);
    box-shadow: var(--st-shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
  }
  .auth-ui-list {
    margin: 0; padding: 0; list-style: none;
    background: var(--st-color-surface, #ffffff);
    border-radius: var(--st-radius-lg, 0.5rem);
    box-shadow: var(--st-shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
    overflow: hidden;
  }
  .auth-ui-list__item {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 1rem; padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--st-color-border, #e5e7eb);
  }
  .auth-ui-list__item:last-child { border-bottom: none; }
  .auth-ui-list__primary { flex: 1; display: flex; flex-direction: column; gap: 0.375rem; }
  .auth-ui-list__meta {
    display: flex; flex-wrap: wrap; gap: 0.75rem;
    font-size: 0.8rem; color: var(--st-color-text-muted, #6b7280);
  }
  .auth-ui-list__actions { display: flex; align-items: center; gap: 0.5rem; }
  .auth-ui-edit { display: flex; align-items: center; gap: 0.5rem; }
  .auth-ui-badge {
    display: inline-flex; align-items: center;
    padding: 0.15rem 0.5rem;
    background: var(--st-color-success-subtle, #d1fae5);
    color: var(--st-color-success, #065f46);
    border-radius: var(--st-radius, 0.375rem);
    font-size: 0.7rem; font-weight: 500;
  }
  .auth-ui-actions { text-align: center; }
</style>
