<script lang="ts">
	import { goto } from '$app/navigation';
	import { apiPost } from '$lib/utils/api';
	import { setUser } from '$lib/stores/session';
	import { get } from 'svelte/store';
	import { _ } from 'svelte-i18n';
	  import {
	    isWebAuthnSupported,
	    startWebAuthnAuthentication,
	    getWebAuthnErrorMessage,
	  } from '$lib/services/webauthn-client';
	  import { onMount } from 'svelte';

let loading = false;
let error = '';
let webauthnSupported = false;
let showLostDevice = false;

	  onMount(() => {
	    webauthnSupported = isWebAuthnSupported();
	    if (!webauthnSupported) {
	      error = get(_)('auth.login.unsupportedBrowser');
	    }
	  });

  async function handleLogin() {
    loading = true;
    error = '';

    try {
      // Step 1: Get authentication options from server (no email needed for passkeys)
      const { options } = await apiPost('/auth/login/options', {});

      // Step 2: Start WebAuthn authentication with authenticator
      const credential = await startWebAuthnAuthentication(options);

      // Step 3: Verify authentication with server
      const data = await apiPost('/auth/login/verify', {
        credential,
      });

      // Update session store with user info
      setUser({
        id: data.user.id,
        email: data.user.email,
        displayName: data.user.displayName,
        role: data.user.role,
      });

      // Store session info (optional, cookies are set by server)
      if (data.sessionToken) {
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('refreshToken', data.refreshToken);
      }

      // Redirect to dashboard or previous page
      const returnUrl = new URLSearchParams(window.location.search).get('returnUrl') || '/home';
      goto(returnUrl);
    } catch (err: any) {
      error = getWebAuthnErrorMessage(err);
      loading = false;
    }
  }

  async function handleLostDevice() {
    showLostDevice = true;
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="max-w-md w-full space-y-8">
	    <div>
	      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
	        {$_('auth.login.title')}
	      </h2>
	      <p class="mt-2 text-center text-sm text-gray-600">
	        {webauthnSupported 
	          ? $_('auth.login.supportedHint')
	          : $_('auth.login.notAvailable')}
	      </p>
	    </div>

    {#if !webauthnSupported}
      <div class="rounded-md bg-red-50 p-4">
        <p class="text-sm text-red-800">{error}</p>
          </div>
    {:else if !showLostDevice}
      <div class="mt-8 space-y-6">
        {#if error}
          <div class="rounded-md bg-red-50 p-4">
            <p class="text-sm text-red-800">{error}</p>
          </div>
        {/if}

        <div>
          <button
            on:click={handleLogin}
            disabled={loading}
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
	          >
	            {loading ? $_('auth.login.buttonLoading') : $_('auth.login.button')}
	          </button>
	        </div>

        <div class="text-center">
          <button
            type="button"
            class="font-medium text-indigo-600 hover:text-indigo-500 bg-transparent border-none cursor-pointer"
            on:click={handleLostDevice}
	          >
	            {$_('auth.login.lostDevice')}
	          </button>
	        </div>

	        <div class="text-center">
	          <a href="/auth/register" class="font-medium text-indigo-600 hover:text-indigo-500">
	            {$_('auth.login.noAccount')}
	          </a>
	        </div>
	      </div>
	    {:else}
      <div class="mt-8 space-y-6">
          <div class="rounded-md bg-blue-50 p-4">
            <div class="flex">
              <div class="ml-3">
	                <h3 class="text-sm font-medium text-blue-800">
	                {$_('auth.login.lostDeviceTitle')}
	                </h3>
	                <div class="mt-2 text-sm text-blue-700">
	                <p>{$_('auth.webauthnRegisterNotice')}</p>
	              </div>
	            </div>
	          </div>
	        </div>

	        <div class="text-center">
	          <a href="/auth/register" class="font-medium text-indigo-600 hover:text-indigo-500">
	            {$_('auth.login.registerNewDevice')}
	          </a>
	        </div>

        <div class="text-center">
          <button
            type="button"
            class="font-medium text-gray-600 hover:text-gray-500 bg-transparent border-none cursor-pointer"
            on:click={() => showLostDevice = false}
	          >
	            {$_('auth.login.backToLogin')}
	          </button>
	        </div>
	      </div>
	    {/if}
  </div>
</div>
