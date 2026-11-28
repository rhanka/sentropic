<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, Button, Input, Typography } from '@sentropic/design-system-svelte';
  import {
    createAuthUiError,
    createDefaultAuthUiLabels,
    normalizeAuthEmail,
    type AuthUiError,
    type AuthUiFederationProvider,
    type AuthUiLabels,
    type AuthUiSession,
    type AuthUiTransport,
  } from '../contracts.js';
  import {
    isWebAuthnSupported,
    startPasskeyAuthentication,
    getWebAuthnErrorMessage,
  } from '../webauthn.js';
  import AuthFederationButtons from './AuthFederationButtons.svelte';

  interface Props {
    transport: AuthUiTransport;
    labels?: Partial<AuthUiLabels>;
    onLoggedIn: (session: AuthUiSession) => void | Promise<void>;
    onLostDevice?: () => void;
    onError?: (error: AuthUiError) => void;
    /**
     * BR-39r L4 — OIDC `login_hint`: optional email hint forwarded to the authentication-options
     * request so the IdP can scope the passkey challenge to a known user. Passkey login stays
     * discoverable; the hint is advisory.
     */
    presetEmail?: string;
    /**
     * BR-39e Lot 6 (D17) — optional social/enterprise providers. Each renders a DS-styled button
     * that redirects to its `startHref` (`GET /auth/federation/:provider/start`). Empty/absent →
     * no federation UI (legacy hosts unaffected, K-UI-LEGACY).
     */
    federationProviders?: AuthUiFederationProvider[];
    /**
     * Per-client policy: when true, show the one-click e-mail magic-link sign-in form as the
     * primary flow instead of WebAuthn or 6-digit-code registration.
     */
    magicLinkSignIn?: boolean;
    /** Sealed OAuth `continue` parameter from the current login page, forwarded to magic-link request. */
    oauthContinuation?: string;
    /** Relative `returnUrl` parameter from the current login page, forwarded when no `continue` is set. */
    returnUrl?: string;
  }

  let {
    transport,
    labels,
    onLoggedIn,
    onLostDevice,
    onError,
    presetEmail,
    federationProviders = [],
    magicLinkSignIn = false,
    oauthContinuation,
    returnUrl,
  }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));

  let loading = $state(false);
  let error = $state('');
  let webauthnSupported = $state(false);
  let showLostDevice = $state(false);
  let email = $state(presetEmail ?? '');
  let magicLinkSent = $state(false);

  onMount(() => {
    webauthnSupported = isWebAuthnSupported();
    if (!magicLinkSignIn && !webauthnSupported) {
      error = resolvedLabels.loginUnsupportedBrowser;
    }
  });

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleRequestMagicLink(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    const normalized = normalizeAuthEmail(email);
    if (!normalized || !isValidEmail(normalized)) {
      error = resolvedLabels.registerErrorInvalidEmail;
      return;
    }
    if (!transport.requestMagicLink) {
      const unsupported = createAuthUiError('invalid_input', resolvedLabels.magicLinkSendFailed);
      error = unsupported.message;
      onError?.(unsupported);
      return;
    }
    email = normalized;
    loading = true;
    error = '';

    const result = await transport.requestMagicLink({
      email: normalized,
      ...(oauthContinuation ? { continue: oauthContinuation } : returnUrl ? { returnUrl } : {}),
    });
    loading = false;
    if (!result.ok) {
      error = result.error.message || resolvedLabels.magicLinkSendFailed;
      onError?.(result.error);
      return;
    }
    magicLinkSent = true;
  }

  function resetMagicLinkForm(): void {
    magicLinkSent = false;
    error = '';
  }

  async function handleLogin(): Promise<void> {
    loading = true;
    error = '';
    try {
      const optionsResult = await transport.createPasskeyAuthenticationOptions(
        presetEmail ? { email: presetEmail } : {}
      );
      if (!optionsResult.ok) {
        error = optionsResult.error.message;
        onError?.(optionsResult.error);
        loading = false;
        return;
      }

      let credential;
      try {
        credential = await startPasskeyAuthentication(optionsResult.value.options);
      } catch (err) {
        const authError = err as AuthUiError;
        error = getWebAuthnErrorMessage(authError, resolvedLabels);
        onError?.(authError);
        loading = false;
        return;
      }

      const verifyResult = await transport.verifyPasskeyAuthentication({ credential });
      if (!verifyResult.ok) {
        error = verifyResult.error.message;
        onError?.(verifyResult.error);
        loading = false;
        return;
      }

      await onLoggedIn(verifyResult.value);
    } finally {
      loading = false;
    }
  }

  function handleLostDevice(): void {
    showLostDevice = true;
    onLostDevice?.();
  }
</script>

<div class="auth-ui-login">
  {#if magicLinkSignIn}
    <header class="auth-ui-header">
      <Typography variant="h2" align="center">{resolvedLabels.magicLinkLoginTitle}</Typography>
      <Typography variant="body-sm" tone="muted" align="center">
        {resolvedLabels.magicLinkLoginSubtitle}
      </Typography>
    </header>

    {#if magicLinkSent}
      <div class="auth-ui-section">
        <Alert
          tone="success"
          title={resolvedLabels.magicLinkSentTitle}
          message={resolvedLabels.magicLinkSentMessage.replace('{email}', email)}
        />
        <div class="auth-ui-actions">
          <Button variant="ghost" type="button" onclick={resetMagicLinkForm}>
            {resolvedLabels.magicLinkChangeEmail}
          </Button>
        </div>
      </div>
    {:else}
      <form class="auth-ui-section" onsubmit={handleRequestMagicLink}>
        <Input
          id="auth-ui-magic-link-email"
          label={resolvedLabels.registerEmailLabel}
          type="email"
          required
          bind:value={email}
          disabled={loading}
          placeholder={resolvedLabels.emailPlaceholder}
        />
        {#if error}
          <Alert tone="error" title={error} />
        {/if}
        <Button
          variant="primary"
          type="submit"
          disabled={loading || !email.trim() || !isValidEmail(email.trim())}
        >
          {loading ? resolvedLabels.magicLinkSending : resolvedLabels.magicLinkSendButton}
        </Button>
      </form>
    {/if}
  {:else}
    <header class="auth-ui-header">
      <Typography variant="h2" align="center">{resolvedLabels.loginTitle}</Typography>
      <Typography variant="body-sm" tone="muted" align="center">
        {webauthnSupported ? resolvedLabels.loginSupportedHint : resolvedLabels.loginUnavailable}
      </Typography>
    </header>

    {#if !webauthnSupported}
      <Alert tone="error" title={error} />
    {:else if !showLostDevice}
      <div class="auth-ui-section">
        {#if error}
          <Alert tone="error" title={error} />
        {/if}
        <Button variant="primary" type="button" onclick={handleLogin} disabled={loading}>
          {loading ? resolvedLabels.loginButtonLoading : resolvedLabels.loginButton}
        </Button>
        <div class="auth-ui-actions">
          <Button variant="ghost" type="button" onclick={handleLostDevice}>
            {resolvedLabels.loginLostDevice}
          </Button>
        </div>
        <div class="auth-ui-actions">
          <slot name="no-account">
            <Typography variant="body-sm" tone="muted">{resolvedLabels.loginNoAccount}</Typography>
          </slot>
        </div>
        <AuthFederationButtons providers={federationProviders} {labels} />
      </div>
    {:else}
      <div class="auth-ui-section">
        <Alert tone="info" title={resolvedLabels.loginLostDeviceTitle} message={resolvedLabels.webauthnRegisterNotice} />
        <div class="auth-ui-actions">
          <slot name="register-new-device">
            <Typography variant="body-sm" tone="muted">{resolvedLabels.loginRegisterNewDevice}</Typography>
          </slot>
        </div>
        <div class="auth-ui-actions">
          <Button variant="ghost" type="button" onclick={() => (showLostDevice = false)}>
            {resolvedLabels.loginBackToLogin}
          </Button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .auth-ui-login {
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
  .auth-ui-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .auth-ui-actions {
    text-align: center;
  }
</style>
