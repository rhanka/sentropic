<script lang="ts">
  // BR-39e Lot 6 (D17) — authenticated link/unlink surface for federated
  // identities. Prop-driven so it does not depend on a federation REST contract
  // that is out of this UI lot's scope: the host supplies the identity list and
  // performs the unlink via `onUnlink`. Unlink is disabled when it would remove
  // the account's LAST sign-in factor (K-UNLINK-LASTFACTOR / D12); the server
  // independently enforces the same guard (Lot 0). The visual pattern mirrors
  // `AuthDevices.svelte` for consistency.
  import { Alert, Button, Typography } from '@sentropic/design-system-svelte';
  import {
    createDefaultAuthUiLabels,
    type AuthUiError,
    type AuthUiFederationProvider,
    type AuthUiLabels,
    type AuthUiLinkedIdentity,
  } from '../contracts.js';
  import { federationIdentityLabel, isLastSignInFactor } from '../federation.js';
  import AuthFederationButtons from './AuthFederationButtons.svelte';

  interface Props {
    /** Linked identities to display. */
    identities?: AuthUiLinkedIdentity[];
    /** Registered passkey count — a sign-in factor for the last-factor guard. Default 0. */
    credentialCount?: number;
    /** Whether the account can still sign in via magic link. Default false. */
    magicLinkCapable?: boolean;
    /** Providers offered to link a new identity (buttons redirect to their `startHref`). */
    federationProviders?: AuthUiFederationProvider[];
    labels?: Partial<AuthUiLabels>;
    /** Host-controlled date formatter; defaults to ISO date (yyyy-mm-dd). */
    formatDate?: (iso: string) => string;
    /** Async confirmation hook so hosts can render a modal instead of `window.confirm`. */
    confirmUnlink?: (message: string) => boolean | Promise<boolean>;
    /** Host performs the unlink call (e.g. DELETE the identity) and reloads the list. */
    onUnlink?: (identity: AuthUiLinkedIdentity) => void | Promise<void>;
    onError?: (error: AuthUiError) => void;
  }

  let {
    identities = [],
    credentialCount = 0,
    magicLinkCapable = false,
    federationProviders = [],
    labels,
    formatDate = defaultFormatDate,
    confirmUnlink = defaultConfirm,
    onUnlink,
    onError,
  }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));

  let error = $state('');

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

  function lastFactor(identity: AuthUiLinkedIdentity): boolean {
    return isLastSignInFactor(identity, { identities, credentialCount, magicLinkCapable });
  }

  async function unlink(identity: AuthUiLinkedIdentity): Promise<void> {
    error = '';
    if (lastFactor(identity)) {
      // Defensive: the button is already disabled in this case.
      error = resolvedLabels.identitiesUnlinkLastFactor;
      return;
    }
    const message = formatTemplate(resolvedLabels.identitiesConfirmUnlink, {
      provider: federationIdentityLabel(identity),
    });
    const confirmed = await confirmUnlink(message);
    if (!confirmed) {
      return;
    }
    try {
      await onUnlink?.(identity);
    } catch (cause) {
      const authError = cause as AuthUiError;
      error = authError?.message || resolvedLabels.identitiesErrorUnlink;
      onError?.(authError);
    }
  }
</script>

<div class="auth-ui-identities">
  <header class="auth-ui-header">
    <Typography variant="h1">{resolvedLabels.identitiesTitle}</Typography>
    <Typography variant="body-sm" tone="muted">{resolvedLabels.identitiesSubtitle}</Typography>
  </header>

  {#if error}
    <Alert tone="error" title={error} />
  {/if}

  {#if identities.length === 0}
    <div class="auth-ui-empty">
      <Typography variant="body" tone="muted" align="center">{resolvedLabels.identitiesEmpty}</Typography>
    </div>
  {:else}
    <ul class="auth-ui-list">
      {#each identities as identity (identity.id)}
        <li class="auth-ui-list__item">
          <div class="auth-ui-list__primary">
            <Typography variant="h5" as="h3">{federationIdentityLabel(identity)}</Typography>
            <div class="auth-ui-list__meta">
              {#if identity.email}
                <span>{identity.email}</span>
              {/if}
              {#if identity.linkedAt}
                <span>{formatTemplate(resolvedLabels.identitiesLinkedOn, { date: formatDate(identity.linkedAt) })}</span>
              {/if}
            </div>
          </div>
          <div class="auth-ui-list__actions">
            {#if lastFactor(identity)}
              <Typography variant="caption" tone="muted">{resolvedLabels.identitiesUnlinkLastFactor}</Typography>
            {/if}
            <Button
              variant="danger"
              size="sm"
              type="button"
              disabled={lastFactor(identity)}
              data-identity={identity.id}
              onclick={() => unlink(identity)}
            >
              {resolvedLabels.identitiesUnlink}
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if federationProviders.length > 0}
    <div class="auth-ui-identities__link">
      <Typography variant="h5" as="h2">{resolvedLabels.identitiesLinkAnother}</Typography>
      <AuthFederationButtons
        providers={federationProviders}
        {labels}
        showDivider={false}
        labelTemplate={resolvedLabels.identitiesLinkButton}
      />
    </div>
  {/if}
</div>

<style>
  .auth-ui-identities {
    display: flex; flex-direction: column; gap: 1.5rem;
    max-width: 48rem; margin: 0 auto; padding: 2rem 1rem;
  }
  .auth-ui-header { display: flex; flex-direction: column; gap: 0.5rem; }
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
  .auth-ui-list__actions {
    display: flex; align-items: center; gap: 0.5rem;
    text-align: right;
  }
  .auth-ui-identities__link {
    display: flex; flex-direction: column; gap: 0.75rem;
    padding-top: 0.5rem;
  }
</style>
