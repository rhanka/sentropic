<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Alert, Button, Input, Typography } from '@sentropic/design-system-svelte';
  import {
    createDefaultAuthUiLabels,
    normalizeAuthEmail,
    type AuthUiError,
    type AuthUiLabels,
    type AuthUiSession,
    type AuthUiTransport,
  } from '../contracts.js';
  import {
    isWebAuthnSupported,
    startPasskeyRegistration,
    getWebAuthnErrorMessage,
  } from '../webauthn.js';

  type Step = 'email' | 'code' | 'webauthn' | 'success';

  interface Props {
    transport: AuthUiTransport;
    labels?: Partial<AuthUiLabels>;
    onRegistered: (session: AuthUiSession) => void | Promise<void>;
    onError?: (error: AuthUiError) => void;
    /**
     * When true, the component skips the email + code steps and renders only
     * the WebAuthn registration. Hosts must then supply `presetEmail`
     * and `presetVerificationToken` (obtained through their own pre-auth flow).
     */
    skipEmailVerification?: boolean;
    presetEmail?: string;
    presetVerificationToken?: string;
    /** Optional default device name passed to the passkey registration. */
    deviceName?: string;
  }

  let {
    transport,
    labels,
    onRegistered,
    onError,
    skipEmailVerification = false,
    presetEmail,
    presetVerificationToken,
    deviceName,
  }: Props = $props();

  const resolvedLabels = $derived(createDefaultAuthUiLabels(labels ?? {}));

  let email = $state(presetEmail ?? '');
  let codeDigits = $state<string[]>(['', '', '', '', '', '']);
  let loading = $state(false);
  let error = $state('');
  let success = $state('');
  let webauthnSupported = $state(false);
  let step = $state<Step>(skipEmailVerification ? 'webauthn' : 'email');
  let verificationToken = $state(presetVerificationToken ?? '');
  let userId = $state('');

  const codeString = $derived(codeDigits.join(''));

  onMount(() => {
    webauthnSupported = isWebAuthnSupported();
    if (!webauthnSupported) {
      error = resolvedLabels.registerUnsupportedBrowser;
    }
  });

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function focusCodeInput(index: number): Promise<void> {
    await tick();
    const target = document.getElementById(`auth-ui-code-${index}`) as HTMLInputElement | null;
    target?.focus();
  }

  function reportError(err: AuthUiError, fallback: string): void {
    error = err.message || fallback;
    onError?.(err);
  }

  async function handleRequestCode(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    const normalized = normalizeAuthEmail(email);
    if (!normalized || !isValidEmail(normalized)) {
      error = resolvedLabels.registerErrorInvalidEmail;
      return;
    }
    email = normalized;
    loading = true;
    error = '';
    success = '';

    const result = await transport.requestEmailCode({ email: normalized });
    loading = false;
    if (!result.ok) {
      reportError(result.error, resolvedLabels.registerErrorSendCode);
      return;
    }
    success = resolvedLabels.registerSuccessCodeSent;
    step = 'code';
    await focusCodeInput(0);
  }

  function updateDigit(index: number, value: string): void {
    const digit = value.replace(/[^0-9]/g, '').slice(0, 1);
    codeDigits[index] = digit;
    if (digit && index < 5) {
      void focusCodeInput(index + 1);
    }
    if (codeString.length === 6 && !loading) {
      setTimeout(() => void handleCodeSubmit(), 100);
    }
  }

  function handleCodeKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !codeDigits[index] && index > 0) {
      codeDigits[index - 1] = '';
      void focusCodeInput(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      void focusCodeInput(index - 1);
    } else if (event.key === 'ArrowRight' && index < 5) {
      void focusCodeInput(index + 1);
    }
  }

  function handleCodePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const digits = pasted.replace(/[^0-9]/g, '').slice(0, 6).split('');
    digits.forEach((digit, index) => {
      codeDigits[index] = digit;
    });
    if (digits.length === 6 && !loading) {
      setTimeout(() => void handleCodeSubmit(), 100);
    } else {
      void focusCodeInput(Math.min(digits.length, 5));
    }
  }

  async function handleCodeSubmit(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (loading || codeString.length !== 6) {
      return;
    }
    loading = true;
    error = '';
    success = '';

    const result = await transport.verifyEmailCode({
      email: normalizeAuthEmail(email),
      code: codeString,
    });
    loading = false;
    if (!result.ok) {
      reportError(result.error, result.error.message);
      codeDigits = ['', '', '', '', '', ''];
      await focusCodeInput(0);
      return;
    }
    verificationToken = result.value.verificationToken;
    step = 'webauthn';
  }

  async function handleWebAuthnRegister(): Promise<void> {
    loading = true;
    error = '';
    success = '';

    const optionsResult = await transport.createPasskeyRegistrationOptions({
      email: normalizeAuthEmail(email),
      verificationToken,
      deviceName,
    });
    if (!optionsResult.ok) {
      reportError(optionsResult.error, optionsResult.error.message);
      loading = false;
      return;
    }
    userId = optionsResult.value.userId;

    let credential;
    try {
      credential = await startPasskeyRegistration(optionsResult.value.options);
    } catch (err) {
      const authError = err as AuthUiError;
      error = getWebAuthnErrorMessage(authError, resolvedLabels);
      onError?.(authError);
      loading = false;
      return;
    }

    const verifyResult = await transport.verifyPasskeyRegistration({
      email: normalizeAuthEmail(email),
      verificationToken,
      userId,
      credential,
      deviceName,
    });
    loading = false;
    if (!verifyResult.ok) {
      reportError(verifyResult.error, verifyResult.error.message);
      return;
    }
    step = 'success';
    success = resolvedLabels.registerSuccessRedirecting;
    await onRegistered(verifyResult.value);
  }

  function backToEmail(): void {
    step = 'email';
    codeDigits = ['', '', '', '', '', ''];
  }
</script>

<div class="auth-ui-register">
  <header class="auth-ui-header">
    <Typography variant="h2" align="center">{resolvedLabels.registerTitle}</Typography>
    <Typography variant="body-sm" tone="muted" align="center">{resolvedLabels.registerSubtitle}</Typography>
  </header>

  {#if !webauthnSupported}
    <Alert tone="error" title={resolvedLabels.registerUnsupportedBrowserTitle} message={error} />
  {:else if step === 'email'}
    <form class="auth-ui-form" onsubmit={handleRequestCode}>
      <Input
        id="auth-ui-register-email"
        label={resolvedLabels.registerEmailLabel}
        type="email"
        required
        bind:value={email}
        disabled={loading}
        placeholder={resolvedLabels.emailPlaceholder}
      />
      {#if success}
        <Alert tone="success" title={success} />
      {/if}
      <Button
        variant="primary"
        type="submit"
        disabled={loading || !email.trim() || !isValidEmail(email.trim())}
      >
        {loading ? resolvedLabels.registerSendingCode : resolvedLabels.registerGetCode}
      </Button>
      {#if error}
        <Alert tone="error" title={error} />
      {/if}
      <div class="auth-ui-actions">
        <slot name="login-link">
          <Typography variant="body-sm" tone="muted">{resolvedLabels.registerAlreadyHaveAccount}</Typography>
        </slot>
      </div>
    </form>
  {:else if step === 'code'}
    <form class="auth-ui-form" onsubmit={handleCodeSubmit}>
      <Input
        id="auth-ui-register-email-readonly"
        label={resolvedLabels.registerEmailLabel}
        type="email"
        value={email}
        disabled
      />
      <div class="auth-ui-field">
        <label class="auth-ui-label" for="auth-ui-code-0">{resolvedLabels.registerCodeLabel}</label>
        <div class="auth-ui-code-row" onpaste={handleCodePaste}>
          {#each codeDigits as _, index (index)}
            <input
              id={`auth-ui-code-${index}`}
              type="text"
              inputmode="numeric"
              maxlength="1"
              disabled={loading}
              bind:value={codeDigits[index]}
              oninput={(e) => updateDigit(index, e.currentTarget.value)}
              onkeydown={(e) => handleCodeKeydown(index, e)}
              autocomplete="off"
              class="auth-ui-code-input"
            />
          {/each}
        </div>
        <Typography variant="caption" tone="muted" align="center">{resolvedLabels.registerCodeHelp}</Typography>
      </div>
      {#if error}
        <Alert tone="error" title={error} />
      {/if}
      <Button variant="primary" type="submit" disabled={loading || codeString.length !== 6}>
        {loading ? resolvedLabels.registerVerifyingCode : resolvedLabels.registerVerifyCode}
      </Button>
      <Button variant="secondary" type="button" onclick={backToEmail}>
        {resolvedLabels.registerChangeEmail}
      </Button>
    </form>
  {:else if step === 'webauthn'}
    <div class="auth-ui-section">
      <Alert tone="info" title={resolvedLabels.registerCodeVerifiedTitle} message={resolvedLabels.registerDeviceNow} />
      {#if error}
        <Alert tone="error" title={error} />
      {/if}
      <Button variant="primary" type="button" disabled={loading} onclick={handleWebAuthnRegister}>
        {loading ? resolvedLabels.registerRegistering : resolvedLabels.registerPasskeyButton}
      </Button>
    </div>
  {:else if step === 'success'}
    <Alert tone="success" title={resolvedLabels.registerSuccessTitle} message={success} />
  {/if}
</div>

<style>
  .auth-ui-register {
    display: flex; flex-direction: column; gap: 1.5rem;
    max-width: 28rem; margin: 0 auto; padding: 2rem 1rem;
  }
  .auth-ui-header { text-align: center; display: flex; flex-direction: column; gap: 0.5rem; }
  .auth-ui-form, .auth-ui-section {
    display: flex; flex-direction: column; gap: 1rem;
  }
  .auth-ui-field { display: flex; flex-direction: column; gap: 0.375rem; }
  .auth-ui-label { font-size: 0.875rem; font-weight: 500; }
  .auth-ui-code-row { display: flex; gap: 0.5rem; justify-content: center; }
  .auth-ui-code-input {
    width: 3rem; height: 3.5rem;
    text-align: center;
    font-size: 1.5rem; font-weight: 600;
    border: 2px solid var(--st-color-border, #d1d5db);
    border-radius: var(--st-radius-lg, 0.5rem);
  }
  .auth-ui-code-input:focus { outline: none; border-color: var(--st-color-primary, #4f46e5); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15); }
  .auth-ui-code-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .auth-ui-actions { text-align: center; }
</style>
