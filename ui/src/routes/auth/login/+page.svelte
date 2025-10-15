<script lang="ts">
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/config';
  import {
    isWebAuthnSupported,
    startWebAuthnAuthentication,
    getWebAuthnErrorMessage,
  } from '$lib/services/webauthn-client';
  import { onMount } from 'svelte';

  let userName = '';
  let loading = false;
  let error = '';
  let webauthnSupported = false;
  let showMagicLink = false;
  let magicLinkEmail = '';
  let magicLinkSent = false;

  onMount(() => {
    webauthnSupported = isWebAuthnSupported();
    if (!webauthnSupported) {
      error = 'Votre navigateur ne supporte pas WebAuthn. Utilisez le lien magique.';
      showMagicLink = true;
    }
  });

  async function handleLogin() {
    loading = true;
    error = '';

    try {
      // Step 1: Get authentication options from server
      const optionsRes = await fetch(`${API_BASE_URL}/auth/login/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: userName || undefined,
        }),
      });

      if (!optionsRes.ok) {
        const errData = await optionsRes.json();
        throw new Error(errData.error || 'Failed to get authentication options');
      }

      const { options } = await optionsRes.json();

      // Step 2: Start WebAuthn authentication with authenticator
      const credential = await startWebAuthnAuthentication(options);

      // Step 3: Verify authentication with server
      const verifyRes = await fetch(`${API_BASE_URL}/auth/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Important for cookies
        body: JSON.stringify({
          credential,
        }),
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json();
        throw new Error(errData.error || 'Authentication failed');
      }

      const data = await verifyRes.json();

      // Store session info (optional, cookies are set by server)
      if (data.sessionToken) {
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('refreshToken', data.refreshToken);
      }

      // Redirect to dashboard or previous page
      const returnUrl = new URLSearchParams(window.location.search).get('returnUrl') || '/dashboard';
      goto(returnUrl);
    } catch (err: any) {
      error = getWebAuthnErrorMessage(err);
      loading = false;
    }
  }

  async function handleMagicLinkRequest() {
    if (!magicLinkEmail) {
      error = 'Email requis';
      return;
    }

    loading = true;
    error = '';

    try {
      const res = await fetch(`${API_BASE_URL}/auth/magic-link/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicLinkEmail }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to send magic link');
      }

      magicLinkSent = true;
    } catch (err: any) {
      error = err.message || 'Erreur lors de l\'envoi du lien magique';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="max-w-md w-full space-y-8">
    <div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        Connexion
      </h2>
      <p class="mt-2 text-center text-sm text-gray-600">
        {webauthnSupported 
          ? 'Utilisez votre passkey ou biométrie' 
          : 'Utilisez un lien magique par email'}
      </p>
    </div>

    {#if !showMagicLink}
      <form class="mt-8 space-y-6" on:submit|preventDefault={handleLogin}>
        <div class="rounded-md shadow-sm space-y-4">
          <div>
            <label for="userName" class="block text-sm font-medium text-gray-700">
              Nom d'utilisateur / Email (optionnel)
            </label>
            <input
              id="userName"
              name="userName"
              type="text"
              bind:value={userName}
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="Laisser vide pour passkey"
            />
            <p class="mt-1 text-xs text-gray-500">
              Laissez vide si vous utilisez un passkey (découvrable)
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
            disabled={loading || !webauthnSupported}
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Connexion...' : 'Se connecter avec WebAuthn'}
          </button>

          <button
            type="button"
            on:click={() => showMagicLink = true}
            class="w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            Utiliser un lien magique
          </button>
        </div>

        <div class="text-center">
          <a href="/auth/register" class="font-medium text-indigo-600 hover:text-indigo-500">
            Pas encore de compte ? S'inscrire
          </a>
        </div>
      </form>
    {:else}
      <!-- Magic Link Form -->
      {#if !magicLinkSent}
        <form class="mt-8 space-y-6" on:submit|preventDefault={handleMagicLinkRequest}>
          <div>
            <label for="magicLinkEmail" class="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="magicLinkEmail"
              name="magicLinkEmail"
              type="email"
              required
              bind:value={magicLinkEmail}
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="votre@email.com"
            />
          </div>

          {#if error}
            <div class="rounded-md bg-red-50 p-4">
              <p class="text-sm text-red-800">{error}</p>
            </div>
          {/if}

          <div class="space-y-3">
            <button
              type="submit"
              disabled={loading}
              class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Envoi...' : 'Envoyer le lien magique'}
            </button>

            {#if webauthnSupported}
              <button
                type="button"
                on:click={() => showMagicLink = false}
                class="w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Retour à WebAuthn
              </button>
            {/if}
          </div>
        </form>
      {:else}
        <div class="mt-8">
          <div class="rounded-md bg-blue-50 p-4">
            <div class="flex">
              <div class="ml-3">
                <h3 class="text-sm font-medium text-blue-800">
                  Vérifiez votre email
                </h3>
                <div class="mt-2 text-sm text-blue-700">
                  <p>Un lien de connexion a été envoyé à <strong>{magicLinkEmail}</strong></p>
                  <p class="mt-2">Cliquez sur le lien dans l'email pour vous connecter.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

