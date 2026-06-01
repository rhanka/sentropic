<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createDefaultOAuthConsentLabels,
    type AuthUiError,
    type OAuthConsentDetails,
    type OAuthConsentLabels,
    type OAuthConsentTransport,
  } from '../contracts.js';
  import { createAuthUiError } from '../errors.js';

  interface Props {
    labels?: Partial<OAuthConsentLabels>;
    onError?: (error: AuthUiError) => void;
    onRedirect?: (url: string) => void;
    state: string;
    transport: OAuthConsentTransport;
  }

  let { labels, onError, onRedirect, state, transport }: Props = $props();

  const resolvedLabels = $derived(createDefaultOAuthConsentLabels(labels ?? {}));

  let details = $state<OAuthConsentDetails | null>(null);
  let error = $state('');
  let loading = $state(true);
  let submitting = $state<'approve' | 'deny' | null>(null);

  onMount(loadConsent);

  async function loadConsent(): Promise<void> {
    loading = true;
    error = '';
    try {
      details = await transport.getConsent({ state });
    } catch (cause) {
      handleError(createAuthUiError('transport_error', resolvedLabels.errorGeneric, { cause }));
    } finally {
      loading = false;
    }
  }

  async function submit(decision: 'approve' | 'deny'): Promise<void> {
    submitting = decision;
    error = '';
    try {
      const result = await transport.submitConsentDecision({ decision, state });
      onRedirect?.(result.redirectTo);
    } catch (cause) {
      handleError(createAuthUiError('transport_error', resolvedLabels.errorGeneric, { cause }));
    } finally {
      submitting = null;
    }
  }

  function handleError(err: AuthUiError): void {
    error = err.message;
    onError?.(err);
  }
</script>

<div class="auth-ui-oauth-consent">
  <slot name="branding"></slot>

  {#if loading}
    <div class="auth-ui-loading" role="status">
      <div class="auth-ui-spinner" aria-hidden="true"></div>
      <p class="auth-ui-loading__label">{resolvedLabels.loading}</p>
    </div>
  {:else if error}
    <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
  {:else if details}
    <header class="auth-ui-header">
      <h2 class="auth-ui-title">{resolvedLabels.title}</h2>
      <p class="auth-ui-subtitle">{details.clientName}</p>
    </header>

    <section class="auth-ui-section" aria-labelledby="oauth-consent-scopes">
      <h3 id="oauth-consent-scopes" class="auth-ui-section__title">{resolvedLabels.scopesTitle}</h3>
      <ul class="auth-ui-scope-list">
        {#each details.scopes as scope (scope)}
          <li class="auth-ui-scope-list__item">
            <strong>{scope}</strong>
            <slot name="scope-description" scope={scope}>
              <span>{resolvedLabels.scopeDescriptions[scope] ?? scope}</span>
            </slot>
          </li>
        {/each}
      </ul>
    </section>

    <section class="auth-ui-section">
      <h3 class="auth-ui-section__title">{resolvedLabels.redirectUriLabel}</h3>
      <p class="auth-ui-redirect-uri">{details.redirectUri}</p>
    </section>

    <div class="auth-ui-actions">
      <button
        type="button"
        class="auth-ui-button auth-ui-button--primary"
        disabled={submitting !== null}
        onclick={() => submit('approve')}
      >
        {submitting === 'approve' ? resolvedLabels.approving : resolvedLabels.approve}
      </button>
      <button
        type="button"
        class="auth-ui-button auth-ui-button--secondary"
        disabled={submitting !== null}
        onclick={() => submit('deny')}
      >
        {submitting === 'deny' ? resolvedLabels.denying : resolvedLabels.deny}
      </button>
    </div>

    <slot name="footer"></slot>
  {/if}
</div>

<style>
  .auth-ui-oauth-consent {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 32rem;
    margin: 0 auto;
    padding: 2rem 1rem;
    font-family: var(--auth-font-family, system-ui, -apple-system, sans-serif);
    color: var(--auth-text, #111827);
  }
  .auth-ui-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    text-align: center;
  }
  .auth-ui-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
  }
  .auth-ui-subtitle {
    margin: 0;
    font-size: 0.95rem;
    color: var(--auth-muted, #6b7280);
  }
  .auth-ui-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .auth-ui-section__title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .auth-ui-scope-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .auth-ui-scope-list__item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem;
    border: 1px solid var(--auth-border, #e5e7eb);
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-scope-list__item span {
    color: var(--auth-muted, #6b7280);
  }
  .auth-ui-redirect-uri {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
    color: var(--auth-muted, #6b7280);
  }
  .auth-ui-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .auth-ui-button {
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
  .auth-ui-button--secondary {
    background: var(--auth-surface-muted, #f3f4f6);
    color: var(--auth-text, #111827);
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
  .auth-ui-loading {
    text-align: center;
    padding: 3rem 0;
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
    to {
      transform: rotate(360deg);
    }
  }
</style>
