<script lang="ts">
  import { onMount } from 'svelte';
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
    <h1 class="auth-ui-title">{resolvedLabels.devicesTitle}</h1>
    <p class="auth-ui-subtitle">{resolvedLabels.devicesSubtitle}</p>
  </header>

  {#if error}
    <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
  {/if}

  <slot name="pair-cta">
    <div class="auth-ui-cta">
      <p class="auth-ui-cta__text">{resolvedLabels.devicePairSubtitle}</p>
      <span class="auth-ui-button auth-ui-button--primary auth-ui-button--inline">
        {resolvedLabels.devicePairTitle}
      </span>
    </div>
  </slot>

  {#if loading}
    <div class="auth-ui-loading" role="status">
      <div class="auth-ui-spinner" aria-hidden="true"></div>
      <p class="auth-ui-loading__label">{resolvedLabels.loading}</p>
    </div>
  {:else if credentials.length === 0}
    <div class="auth-ui-empty">
      <p>{resolvedLabels.devicesEmpty}</p>
      <slot name="register-device">
        <span class="auth-ui-button auth-ui-button--primary auth-ui-button--inline">
          {resolvedLabels.devicesRegister}
        </span>
      </slot>
    </div>
  {:else}
    <ul class="auth-ui-list">
      {#each credentials as credential (credential.id)}
        <li class="auth-ui-list__item">
          <div class="auth-ui-list__primary">
            {#if editingId === credential.id}
              <div class="auth-ui-edit">
                <input
                  type="text"
                  class="auth-ui-input"
                  bind:value={editingName}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      void saveDeviceName(credential);
                    } else if (e.key === 'Escape') {
                      cancelEdit();
                    }
                  }}
                />
                <button
                  type="button"
                  class="auth-ui-button auth-ui-button--primary auth-ui-button--small"
                  onclick={() => saveDeviceName(credential)}
                >
                  {resolvedLabels.save}
                </button>
                <button
                  type="button"
                  class="auth-ui-button auth-ui-button--ghost auth-ui-button--small"
                  onclick={cancelEdit}
                >
                  {resolvedLabels.cancel}
                </button>
              </div>
            {:else}
              <h3 class="auth-ui-list__name">{credential.deviceName}</h3>
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
              <button type="button" class="auth-ui-link" onclick={() => startEdit(credential)}>
                {resolvedLabels.devicesRename}
              </button>
              <button type="button" class="auth-ui-link auth-ui-link--danger" onclick={() => revoke(credential)}>
                {resolvedLabels.devicesRevoke}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="auth-ui-actions">
      <slot name="add-device">
        <span class="auth-ui-link">{resolvedLabels.devicesAddNew}</span>
      </slot>
    </div>
  {/if}
</div>

<style>
  .auth-ui-devices {
    display: flex; flex-direction: column; gap: 1.5rem;
    max-width: 48rem; margin: 0 auto; padding: 2rem 1rem;
    font-family: var(--auth-font-family, system-ui, -apple-system, sans-serif);
    color: var(--auth-text, #111827);
  }
  .auth-ui-header { display: flex; flex-direction: column; gap: 0.5rem; }
  .auth-ui-title { margin: 0; font-size: 1.75rem; font-weight: 700; }
  .auth-ui-subtitle { margin: 0; font-size: 0.875rem; color: var(--auth-muted, #6b7280); }
  .auth-ui-alert {
    padding: 0.75rem 1rem;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-alert--error { background: var(--auth-error-bg, #fef2f2); color: var(--auth-error-text, #991b1b); }
  .auth-ui-cta {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: 1rem;
    background: var(--auth-info-bg, #eef2ff);
    color: var(--auth-info-text, #312e81);
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-cta__text { margin: 0; }
  .auth-ui-loading { text-align: center; padding: 3rem 0; }
  .auth-ui-spinner {
    display: inline-block; width: 3rem; height: 3rem;
    border: 2px solid transparent;
    border-bottom-color: var(--auth-primary, #4f46e5);
    border-radius: 50%; animation: auth-ui-spin 0.75s linear infinite;
  }
  .auth-ui-loading__label { margin-top: 1rem; font-size: 0.875rem; color: var(--auth-muted, #6b7280); }
  @keyframes auth-ui-spin { to { transform: rotate(360deg); } }
  .auth-ui-empty {
    display: flex; flex-direction: column; align-items: center; gap: 1rem;
    padding: 3rem 1rem;
    background: var(--auth-surface, #ffffff);
    border-radius: var(--auth-radius-lg, 0.5rem);
    box-shadow: var(--auth-shadow, 0 1px 2px rgba(0,0,0,0.05));
    color: var(--auth-muted, #6b7280);
  }
  .auth-ui-list {
    margin: 0; padding: 0; list-style: none;
    background: var(--auth-surface, #ffffff);
    border-radius: var(--auth-radius-lg, 0.5rem);
    box-shadow: var(--auth-shadow, 0 1px 2px rgba(0,0,0,0.05));
    overflow: hidden;
  }
  .auth-ui-list__item {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 1rem; padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--auth-border, #e5e7eb);
  }
  .auth-ui-list__item:last-child { border-bottom: none; }
  .auth-ui-list__primary { flex: 1; display: flex; flex-direction: column; gap: 0.375rem; }
  .auth-ui-list__name { margin: 0; font-size: 1.05rem; font-weight: 600; }
  .auth-ui-list__meta {
    display: flex; flex-wrap: wrap; gap: 0.75rem;
    font-size: 0.8rem; color: var(--auth-muted, #6b7280);
  }
  .auth-ui-list__actions { display: flex; align-items: center; gap: 0.5rem; }
  .auth-ui-edit { display: flex; align-items: center; gap: 0.5rem; }
  .auth-ui-input {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--auth-border, #d1d5db);
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-input:focus { outline: none; border-color: var(--auth-primary, #4f46e5); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15); }
  .auth-ui-button {
    padding: 0.5rem 1rem; border: none;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem; font-weight: 500; cursor: pointer;
  }
  .auth-ui-button--small { padding: 0.375rem 0.75rem; }
  .auth-ui-button--inline { display: inline-flex; }
  .auth-ui-button--primary { background: var(--auth-primary, #4f46e5); color: var(--auth-primary-text, #ffffff); }
  .auth-ui-button--ghost { background: var(--auth-ghost-bg, #e5e7eb); color: var(--auth-text, #111827); }
  .auth-ui-badge {
    display: inline-flex; align-items: center;
    padding: 0.15rem 0.5rem;
    background: var(--auth-success-bg, #d1fae5);
    color: var(--auth-success-text, #065f46);
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.7rem; font-weight: 500;
  }
  .auth-ui-link {
    background: none; border: none; cursor: pointer;
    color: var(--auth-link, #4f46e5);
    font-size: 0.875rem; font-weight: 500;
  }
  .auth-ui-link--danger { color: var(--auth-danger, #dc2626); }
  .auth-ui-link:hover { text-decoration: underline; }
  .auth-ui-actions { text-align: center; }
</style>
