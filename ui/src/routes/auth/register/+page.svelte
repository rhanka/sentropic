<script lang="ts">
	  import { goto } from '$app/navigation';
	  import { apiPost } from '$lib/utils/api';
	  import { setUser } from '$lib/stores/session';
	  import { get } from 'svelte/store';
	  import { _ } from 'svelte-i18n';
	  import {
	    isWebAuthnSupported,
	    startWebAuthnRegistration,
	    getWebAuthnErrorMessage,
	  } from '$lib/services/webauthn-client';
  import { onMount } from 'svelte';
  import { CheckCircle2 } from '@lucide/svelte';

  let email = '';
  let code = '';
  let codeDigits = ['', '', '', '', '', '']; // Array for 6 individual code inputs
  let loading = false;
  let error = '';
  let success = '';
  let webauthnSupported = false;
  let step: 'email' | 'code' | 'webauthn' | 'success' = 'email';
  let userId = '';
  let verificationToken = '';

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

	  onMount(() => {
	    webauthnSupported = isWebAuthnSupported();
	    if (!webauthnSupported) {
	      error = get(_)('auth.register.unsupportedBrowser');
	    }
	  });

	  async function handleRequestCode() {
	    const normalizedEmail = email.trim().toLowerCase();
	    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
	      error = get(_)('auth.register.errors.invalidEmail');
	      return;
	    }

    email = normalizedEmail;
    loading = true;
    error = '';
    success = '';

	    try {
	      await apiPost('/auth/email/verify-request', {
	        email: normalizedEmail,
	      });

	      step = 'code';
	      success = get(_)('auth.register.success.codeSent');
	      // Auto-focus first code input
      setTimeout(() => {
        const firstInput = document.getElementById('code-0') as HTMLInputElement;
        firstInput?.focus();
      }, 100);
	    } catch (err: any) {
	      error = err.message || get(_)('auth.register.errors.sendCode');
	    } finally {
	      loading = false;
	    }
	  }

  function handleCodeInput(index: number, value: string) {
    // Only allow digits
    const digit = value.replace(/[^0-9]/g, '').slice(0, 1);
    codeDigits[index] = digit;
    
    // Auto-focus next input if digit entered
    if (digit && index < 5) {
      const nextInput = document.getElementById(`code-${index + 1}`) as HTMLInputElement;
      nextInput?.focus();
    }
    
    // Update code string
    code = codeDigits.join('');
    
    // Auto-submit if all 6 digits are filled (but not if already loading)
    if (code.length === 6 && !loading) {
      setTimeout(() => handleCodeSubmit(), 100);
    }
  }

  function handleCodeKeydown(index: number, event: KeyboardEvent) {
    // Handle backspace: delete current and focus previous
    if (event.key === 'Backspace' && !codeDigits[index] && index > 0) {
      const prevInput = document.getElementById(`code-${index - 1}`) as HTMLInputElement;
      prevInput?.focus();
      codeDigits[index - 1] = '';
      code = codeDigits.join('');
    }
    
    // Handle arrow keys
    if (event.key === 'ArrowLeft' && index > 0) {
      const prevInput = document.getElementById(`code-${index - 1}`) as HTMLInputElement;
      prevInput?.focus();
    }
    if (event.key === 'ArrowRight' && index < 5) {
      const nextInput = document.getElementById(`code-${index + 1}`) as HTMLInputElement;
      nextInput?.focus();
    }
  }

  function handleCodePaste(event: ClipboardEvent) {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text') || '';
    const digits = pastedData.replace(/[^0-9]/g, '').slice(0, 6).split('');
    
    digits.forEach((digit, i) => {
      if (i < 6) {
        codeDigits[i] = digit;
      }
    });
    
    code = codeDigits.join('');
    
    // Focus last filled input or first empty
    const lastFilledIndex = Math.min(digits.length - 1, 5);
    const nextInput = document.getElementById(`code-${lastFilledIndex}`) as HTMLInputElement;
    nextInput?.focus();
    
    // Auto-submit if all 6 digits are filled (but not if already loading)
    if (code.length === 6 && !loading) {
      setTimeout(() => handleCodeSubmit(), 100);
    }
  }

  async function handleCodeSubmit() {
    const fullCode = codeDigits.join('');
    if (!fullCode || fullCode.length !== 6) {
      error = 'Le code doit contenir 6 chiffres';
      return;
    }

    if (loading) return; // Prevent multiple submissions

    loading = true;
    error = '';
    success = '';

    try {
      const { verificationToken: token } = await apiPost('/auth/email/verify-code', {
        email: email.trim().toLowerCase(),
        code: fullCode,
      });

      verificationToken = token;
      step = 'webauthn';
    } catch (err: any) {
      error = err.message || 'Code invalide';
      // Clear code on error
      codeDigits = ['', '', '', '', '', ''];
      code = '';
      // Focus first input
      setTimeout(() => {
        const firstInput = document.getElementById('code-0') as HTMLInputElement;
        firstInput?.focus();
      }, 100);
    } finally {
      loading = false;
    }
  }

  async function handleWebAuthnRegister() {
    loading = true;
    error = '';
    success = '';

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const responseData = await apiPost('/auth/register/options', {
        email: normalizedEmail,
        verificationToken,
      });

      const { options, userId: tempUserId } = responseData;
      userId = tempUserId;

      const credential = await startWebAuthnRegistration(options);
      await verifyRegistration(credential);
    } catch (err: any) {
        error = getWebAuthnErrorMessage(err);
      loading = false;
    }
  }

  async function verifyRegistration(credential: any) {
    try {
      const data = await apiPost('/auth/register/verify', {
        email: email.trim().toLowerCase(),
        verificationToken,
        userId,
        credential,
      });

      setUser({
        id: data.user.id,
        email: data.user.email,
        displayName: data.user.displayName,
        role: data.user.role,
      });

      if (data.sessionToken) {
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('refreshToken', data.refreshToken);
      }

      step = 'success';
      success = get(_)('auth.register.success.redirecting');

      setTimeout(() => {
        goto('/home');
      }, 2000);
    } catch (err: any) {
      error = getWebAuthnErrorMessage(err);
    } finally {
      loading = false;
    }
  }

  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="max-w-md w-full space-y-8">
	    <div>
	      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
	        {$_('auth.register.title')}
	      </h2>
	      <p class="mt-2 text-center text-sm text-gray-600">
	        {$_('auth.register.subtitle')}
	      </p>
	    </div>

    {#if !webauthnSupported}
      <div class="rounded-md bg-red-50 p-4">
	        <div class="flex">
	          <div class="ml-3">
	            <h3 class="text-sm font-medium text-red-800">
	              {$_('auth.register.unsupportedBrowserTitle')}
	            </h3>
	            <div class="mt-2 text-sm text-red-700">
	              <p>{error}</p>
	            </div>
	          </div>
	        </div>
      </div>
    {:else if step === 'email'}
      <form class="mt-8 space-y-6" on:submit|preventDefault={handleRequestCode}>
        <div class="rounded-md shadow-sm space-y-4">
	          <div>
	            <label for="email" class="block text-sm font-medium text-gray-700">
	              {$_('auth.register.emailLabel')}
	            </label>
	            <input
              id="email"
              name="email"
              type="email"
              required
              bind:value={email}
              disabled={loading}
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm disabled:opacity-50"
	              placeholder={$_('auth.emailPlaceholder')}
	            />
	          </div>
	        </div>

        {#if success}
          <div class="rounded-md bg-green-50 p-4">
            <p class="text-sm text-green-800">{success}</p>
          </div>
        {/if}

        <div class="space-y-3">
          <button
            type="submit"
            disabled={loading || !email.trim() || !isValidEmail(email.trim())}
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
	          >
	            {loading ? $_('auth.register.sendingCode') : $_('auth.register.getCode')}
	          </button>

          {#if error}
            <div class="rounded-md bg-red-50 p-4">
              <p class="text-sm text-red-800">{error}</p>
            </div>
          {/if}

	          <div class="text-center">
	            <a href="/auth/login" class="font-medium text-indigo-600 hover:text-indigo-500">
	              {$_('auth.register.alreadyHaveAccount')}
	            </a>
	          </div>
	        </div>
	      </form>
    {:else if step === 'code'}
      <form class="mt-8 space-y-6" on:submit|preventDefault={handleCodeSubmit}>
        <div class="rounded-md shadow-sm space-y-4">
	          <div>
	            <label for="email" class="block text-sm font-medium text-gray-700">
	              {$_('auth.register.emailLabel')}
	            </label>
            <input
              id="email"
              name="email"
              type="email"
              bind:value={email}
              disabled
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 bg-gray-100 text-gray-500 rounded-md sm:text-sm"
            />
          </div>
	          <div>
	            <label for="code-0" class="block text-sm font-medium text-gray-700 mb-3">
	              {$_('auth.register.codeLabel')}
	            </label>
            <div class="flex gap-2 justify-center" on:paste={handleCodePaste}>
              {#each range(codeDigits.length) as index (index)}
                <input
                  id="code-{index}"
                  type="text"
                  inputmode="numeric"
                  maxlength="1"
                  disabled={loading}
                  bind:value={codeDigits[index]}
                  on:input={(e) => handleCodeInput(index, e.currentTarget.value)}
                  on:keydown={(e) => handleCodeKeydown(index, e)}
                  class="w-12 h-14 text-center text-2xl font-semibold border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  autocomplete="off"
                />
              {/each}
            </div>
	            <p class="mt-2 text-xs text-gray-500 text-center">
	              {$_('auth.register.codeHelp')}
	            </p>
	          </div>
	        </div>

        {#if error}
          <div class="rounded-md bg-red-50 p-4">
            <p class="text-sm text-red-800">{error}</p>
          </div>
        {/if}

        <div class="space-y-3">
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
	          >
	            {loading ? $_('auth.register.verifyingCode') : $_('auth.register.verifyCode')}
	          </button>
	          <button
            type="button"
            on:click={() => { step = 'email'; code = ''; codeDigits = ['', '', '', '', '', '']; }}
	            class="w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
	          >
	            {$_('auth.register.changeEmail')}
	          </button>
	        </div>
	      </form>
    {:else if step === 'webauthn'}
      <div class="mt-8 space-y-6">
        <div class="rounded-md bg-blue-50 p-4">
          <div class="flex">
	            <div class="ml-3">
	              <h3 class="text-sm font-medium text-blue-800">
	                {$_('auth.register.codeVerifiedTitle')}
	              </h3>
	              <div class="mt-2 text-sm text-blue-700">
	                <p>{$_('auth.registerDeviceNow')}</p>
	              </div>
	            </div>
	          </div>
	        </div>

        {#if error}
          <div class="rounded-md bg-red-50 p-4">
            <p class="text-sm text-red-800">{error}</p>
          </div>
        {/if}

        <div>
          <button
            on:click={handleWebAuthnRegister}
            disabled={loading}
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
	          >
	            {loading ? $_('auth.register.registering') : $_('auth.register.registerDevice')}
	          </button>
	        </div>
	        </div>
	    {:else if step === 'success'}
      <div class="mt-8">
        <div class="rounded-md bg-green-50 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <CheckCircle2 class="h-5 w-5 text-green-400" />
            </div>
            <div class="ml-3">
	              <h3 class="text-sm font-medium text-green-800">
	                {$_('auth.register.successTitle')}
	              </h3>
              <div class="mt-2 text-sm text-green-700">
                <p>{success}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
