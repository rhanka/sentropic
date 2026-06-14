<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, Button, Typography } from '@sentropic/design-system-svelte';
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

  let { labels, onError, onRedirect, state: consentState, transport }: Props = $props();

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
      details = await transport.getConsent({ state: consentState });
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
      const result = await transport.submitConsentDecision({ decision, state: consentState });
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
      <Typography variant="body-sm" tone="muted" align="center">{resolvedLabels.loading}</Typography>
    </div>
  {:else if error}
    <Alert tone="error" title={error} />
  {:else if details}
    <header class="auth-ui-header">
      <Typography variant="h2" align="center">{resolvedLabels.title}</Typography>
      <Typography variant="body" tone="muted" align="center">{details.clientName}</Typography>
    </header>

    <section class="auth-ui-section" aria-labelledby="oauth-consent-scopes">
      <Typography variant="body-sm" weight="semibold" id="oauth-consent-scopes">{resolvedLabels.scopesTitle}</Typography>
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
      <Typography variant="body-sm" weight="semibold">{resolvedLabels.redirectUriLabel}</Typography>
      <p class="auth-ui-redirect-uri">{details.redirectUri}</p>
    </section>

    <div class="auth-ui-actions">
      <Button variant="primary" type="button" disabled={submitting !== null} onclick={() => submit('approve')}>
        {submitting === 'approve' ? resolvedLabels.approving : resolvedLabels.approve}
      </Button>
      <Button variant="secondary" type="button" disabled={submitting !== null} onclick={() => submit('deny')}>
        {submitting === 'deny' ? resolvedLabels.denying : resolvedLabels.deny}
      </Button>
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
  }
  .auth-ui-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    text-align: center;
  }
  .auth-ui-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
    border: 1px solid var(--st-color-border, #e5e7eb);
    border-radius: var(--st-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-scope-list__item span {
    color: var(--st-color-text-muted, #6b7280);
  }
  .auth-ui-redirect-uri {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
    color: var(--st-color-text-muted, #6b7280);
  }
  .auth-ui-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
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
    border-bottom-color: var(--st-color-primary, #4f46e5);
    border-radius: 50%;
    animation: auth-ui-spin 0.75s linear infinite;
    margin-bottom: 1rem;
  }
  @keyframes auth-ui-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
