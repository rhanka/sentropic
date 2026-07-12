<script lang="ts">
  // BR-39e Lot 6 (D17) — social/enterprise provider button row. Each button is a
  // DS-styled browser redirect to the provider's `startHref`
  // (`GET /auth/federation/:provider/start`), NOT an `AuthUiTransport` XHR. An
  // empty/absent `providers` list renders nothing, so legacy hosts are unaffected
  // (K-UI-LEGACY). Reused by `AuthLogin`, `AuthRegister`, and the linked-accounts
  // surface with a per-context copy template.
  import { Button, Typography } from '@sentropic/design-system-svelte';
  import {
    createDefaultAuthUiLabels,
    type AuthUiFederationProvider,
    type AuthUiLabels,
  } from '../contracts.js';
  import { formatFederationLabel } from '../federation.js';
  import AuthProviderGlyph from './AuthProviderGlyph.svelte';

  interface Props {
    /** Providers to offer. Empty/absent → renders nothing (legacy-safe). */
    providers?: AuthUiFederationProvider[];
    labels?: Partial<AuthUiLabels>;
    /** Show the "or" divider above the buttons. Default true. */
    showDivider?: boolean;
    /**
     * Per-button copy template with a `{label}` placeholder. Defaults to
     * `labels.federationContinueWith` ("Continue with {label}"); the linked-
     * accounts surface passes its own "Link {label}" template.
     */
    labelTemplate?: string;
    /**
     * Navigation hook (defaults to a full-page `window.location.assign`
     * redirect). Hosts may override to intercept the redirect.
     */
    onNavigate?: (href: string) => void;
  }

  let {
    providers = [],
    labels,
    showDivider = true,
    labelTemplate,
    onNavigate,
  }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));
  const template = $derived(labelTemplate ?? resolvedLabels.federationContinueWith);

  function navigate(href: string): void {
    if (onNavigate) {
      onNavigate(href);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(href);
    }
  }
</script>

{#if providers.length > 0}
  <div class="auth-ui-federation" data-testid="auth-ui-federation">
    {#if showDivider}
      <div class="auth-ui-federation__divider">
        <span class="auth-ui-federation__divider-line" aria-hidden="true"></span>
        <Typography variant="caption" tone="muted">{resolvedLabels.federationDividerLabel}</Typography>
        <span class="auth-ui-federation__divider-line" aria-hidden="true"></span>
      </div>
    {/if}
    <div class="auth-ui-federation__buttons">
      {#each providers as provider (provider.id)}
        <Button
          variant="secondary"
          type="button"
          data-provider={provider.id}
          data-start-href={provider.startHref}
          onclick={() => navigate(provider.startHref)}
        >
          <span class="auth-ui-federation__button-inner">
            <AuthProviderGlyph id={provider.id} label={provider.label} />
            <span>{formatFederationLabel(template, provider.label)}</span>
          </span>
        </Button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .auth-ui-federation {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .auth-ui-federation__divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .auth-ui-federation__divider-line {
    flex: 1;
    height: 1px;
    background: var(--st-color-border, #e5e7eb);
  }
  .auth-ui-federation__buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .auth-ui-federation__button-inner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
  }
</style>
