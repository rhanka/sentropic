<script lang="ts">
  import { onMount, tick } from 'svelte';
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
    <h2 class="auth-ui-title">{resolvedLabels.registerTitle}</h2>
    <p class="auth-ui-subtitle">{resolvedLabels.registerSubtitle}</p>
  </header>

  {#if !webauthnSupported}
    <div class="auth-ui-alert auth-ui-alert--error" role="alert">
      <h3 class="auth-ui-alert__title">{resolvedLabels.registerUnsupportedBrowserTitle}</h3>
      <p>{error}</p>
    </div>
  {:else if step === 'email'}
    <form class="auth-ui-form" onsubmit={handleRequestCode}>
      <div class="auth-ui-field">
        <label for="auth-ui-register-email" class="auth-ui-label">{resolvedLabels.registerEmailLabel}</label>
        <input
          id="auth-ui-register-email"
          type="email"
          required
          bind:value={email}
          disabled={loading}
          placeholder={resolvedLabels.emailPlaceholder}
          class="auth-ui-input"
        />
      </div>
      {#if success}
        <div class="auth-ui-alert auth-ui-alert--success" role="status">{success}</div>
      {/if}
      <button
        type="submit"
        disabled={loading || !email.trim() || !isValidEmail(email.trim())}
        class="auth-ui-button auth-ui-button--primary"
      >
        {loading ? resolvedLabels.registerSendingCode : resolvedLabels.registerGetCode}
      </button>
      {#if error}
        <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
      {/if}
      <div class="auth-ui-actions">
        <slot name="login-link">
          <span class="auth-ui-link">{resolvedLabels.registerAlreadyHaveAccount}</span>
        </slot>
      </div>
    </form>
  {:else if step === 'code'}
    <form class="auth-ui-form" onsubmit={handleCodeSubmit}>
      <div class="auth-ui-field">
        <label for="auth-ui-register-email-readonly" class="auth-ui-label">{resolvedLabels.registerEmailLabel}</label>
        <input
          id="auth-ui-register-email-readonly"
          type="email"
          value={email}
          disabled
          class="auth-ui-input auth-ui-input--disabled"
        />
      </div>
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
        <p class="auth-ui-help">{resolvedLabels.registerCodeHelp}</p>
      </div>
      {#if error}
        <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
      {/if}
      <button
        type="submit"
        disabled={loading || codeString.length !== 6}
        class="auth-ui-button auth-ui-button--primary"
      >
        {loading ? resolvedLabels.registerVerifyingCode : resolvedLabels.registerVerifyCode}
      </button>
      <button
        type="button"
        class="auth-ui-button auth-ui-button--ghost"
        onclick={backToEmail}
      >
        {resolvedLabels.registerChangeEmail}
      </button>
    </form>
  {:else if step === 'webauthn'}
    <div class="auth-ui-section">
      <div class="auth-ui-alert auth-ui-alert--info" role="status">
        <h3 class="auth-ui-alert__title">{resolvedLabels.registerCodeVerifiedTitle}</h3>
        <p>{resolvedLabels.registerDeviceNow}</p>
      </div>
      {#if error}
        <div class="auth-ui-alert auth-ui-alert--error" role="alert">{error}</div>
      {/if}
      <button
        type="button"
        disabled={loading}
        onclick={handleWebAuthnRegister}
        class="auth-ui-button auth-ui-button--primary"
      >
        {loading ? resolvedLabels.registerRegistering : resolvedLabels.registerPasskeyButton}
      </button>
    </div>
  {:else if step === 'success'}
    <div class="auth-ui-alert auth-ui-alert--success" role="status">
      <h3 class="auth-ui-alert__title">{resolvedLabels.registerSuccessTitle}</h3>
      <p>{success}</p>
    </div>
  {/if}
</div>

<style>
  .auth-ui-register {
    display: flex; flex-direction: column; gap: 1.5rem;
    max-width: 28rem; margin: 0 auto; padding: 2rem 1rem;
    font-family: var(--auth-font-family, system-ui, -apple-system, sans-serif);
    color: var(--auth-text, #111827);
  }
  .auth-ui-header { text-align: center; display: flex; flex-direction: column; gap: 0.5rem; }
  .auth-ui-title { margin: 0; font-size: 1.5rem; font-weight: 700; }
  .auth-ui-subtitle { margin: 0; font-size: 0.875rem; color: var(--auth-muted, #6b7280); }
  .auth-ui-form, .auth-ui-section {
    display: flex; flex-direction: column; gap: 1rem;
  }
  .auth-ui-field { display: flex; flex-direction: column; gap: 0.375rem; }
  .auth-ui-label { font-size: 0.875rem; font-weight: 500; }
  .auth-ui-help { margin: 0.25rem 0 0; font-size: 0.75rem; color: var(--auth-muted, #6b7280); text-align: center; }
  .auth-ui-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--auth-border, #d1d5db);
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-input:focus { outline: none; border-color: var(--auth-primary, #4f46e5); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15); }
  .auth-ui-input--disabled { background: var(--auth-disabled-bg, #f3f4f6); color: var(--auth-muted, #6b7280); }
  .auth-ui-code-row { display: flex; gap: 0.5rem; justify-content: center; }
  .auth-ui-code-input {
    width: 3rem; height: 3.5rem;
    text-align: center;
    font-size: 1.5rem; font-weight: 600;
    border: 2px solid var(--auth-border, #d1d5db);
    border-radius: var(--auth-radius-lg, 0.5rem);
  }
  .auth-ui-code-input:focus { outline: none; border-color: var(--auth-primary, #4f46e5); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15); }
  .auth-ui-code-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .auth-ui-button {
    width: 100%;
    padding: 0.625rem 1rem;
    border: none;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem; font-weight: 500;
    cursor: pointer;
  }
  .auth-ui-button:disabled { opacity: 0.5; cursor: not-allowed; }
  .auth-ui-button--primary { background: var(--auth-primary, #4f46e5); color: var(--auth-primary-text, #ffffff); }
  .auth-ui-button--ghost { background: var(--auth-ghost-bg, #ffffff); border: 1px solid var(--auth-border, #d1d5db); color: var(--auth-text, #111827); }
  .auth-ui-alert {
    padding: 1rem;
    border-radius: var(--auth-radius, 0.375rem);
    font-size: 0.875rem;
  }
  .auth-ui-alert--error { background: var(--auth-error-bg, #fef2f2); color: var(--auth-error-text, #991b1b); }
  .auth-ui-alert--success { background: var(--auth-success-bg, #f0fdf4); color: var(--auth-success-text, #166534); }
  .auth-ui-alert--info { background: var(--auth-info-bg, #eff6ff); color: var(--auth-info-text, #1e3a8a); }
  .auth-ui-alert__title { margin: 0 0 0.25rem; font-size: 0.95rem; font-weight: 600; }
  .auth-ui-actions { text-align: center; }
  .auth-ui-link { color: var(--auth-link, #4f46e5); font-size: 0.875rem; font-weight: 500; text-decoration: none; }
  .auth-ui-link:hover { text-decoration: underline; }
</style>
