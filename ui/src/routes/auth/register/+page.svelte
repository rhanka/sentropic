<script lang="ts">
  import { goto } from '$app/navigation';
  import { apiPost } from '$lib/utils/api';
  import { setUser } from '$lib/stores/session';
  import { 
    isWebAuthnSupported, 
    startWebAuthnRegistration,
    getWebAuthnErrorMessage 
  } from '$lib/services/webauthn-client';
  import { onMount } from 'svelte';

  let userName = '';
  let userDisplayName = '';
  let email = '';
  let deviceName = '';
  let loading = false;
  let error = '';
  let success = '';
  let webauthnSupported = false;
  let step: 'form' | 'device-name' | 'success' = 'form';
  let userId = '';

  onMount(() => {
    webauthnSupported = isWebAuthnSupported();
    if (!webauthnSupported) {
      error = 'Votre navigateur ne supporte pas WebAuthn. Utilisez un navigateur moderne (Chrome, Firefox, Safari, Edge).';
    }
  });

  async function handleRegister() {
    if (!userName || !userDisplayName) {
      error = 'Nom d\'utilisateur et nom d\'affichage requis';
      return;
    }

    loading = true;
    error = '';
    success = '';

    try {
      // Step 1: Get registration options from server
      const responseData = await apiPost('/auth/register/options', {
        userName,
        userDisplayName,
        email: email || undefined,
      });
      
      const { options, userId: tempUserId } = responseData;
      userId = tempUserId;

      // Step 2: Start WebAuthn registration with authenticator
      const credential = await startWebAuthnRegistration(options);

      // Move to device name step
      step = 'device-name';
      success = 'Appareil enregistré ! Donnez-lui un nom pour le reconnaître.';

      // Auto-submit with credential
      await verifyRegistration(credential);
    } catch (err: any) {
      error = getWebAuthnErrorMessage(err);
      loading = false;
    }
  }

  async function verifyRegistration(credential: any) {
    try {
      // Step 3: Verify registration with server
      const data = await apiPost('/auth/register/verify', {
        userName,
        userId,
        credential,
        deviceName: deviceName || undefined,
      });

      // Update session store with user info
      setUser({
        id: data.user.id,
        email: null, // Register API doesn't return email
        displayName: data.user.userName,
        role: data.user.role,
      });

      // Store session info (optional, cookies are set by server)
      if (data.sessionToken) {
        // Could store in sessionStorage if needed
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('refreshToken', data.refreshToken);
      }

      step = 'success';
      success = 'Inscription réussie ! Redirection vers le tableau de bord...';

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        goto('/dashboard');
      }, 2000);
    } catch (err: any) {
      error = getWebAuthnErrorMessage(err);
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="max-w-md w-full space-y-8">
    <div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        Créer un compte
      </h2>
      <p class="mt-2 text-center text-sm text-gray-600">
        Authentification sécurisée avec WebAuthn (passkey ou biométrie)
      </p>
    </div>

    {#if !webauthnSupported}
      <div class="rounded-md bg-red-50 p-4">
        <div class="flex">
          <div class="ml-3">
            <h3 class="text-sm font-medium text-red-800">
              Navigateur non compatible
            </h3>
            <div class="mt-2 text-sm text-red-700">
              <p>{error}</p>
            </div>
          </div>
        </div>
      </div>
    {:else if step === 'form'}
      <form class="mt-8 space-y-6" on:submit|preventDefault={handleRegister}>
        <div class="rounded-md shadow-sm space-y-4">
          <div>
            <label for="userName" class="block text-sm font-medium text-gray-700">
              Nom d'utilisateur / Email
            </label>
            <input
              id="userName"
              name="userName"
              type="text"
              required
              bind:value={userName}
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="votre@email.com"
            />
          </div>

          <div>
            <label for="userDisplayName" class="block text-sm font-medium text-gray-700">
              Nom d'affichage
            </label>
            <input
              id="userDisplayName"
              name="userDisplayName"
              type="text"
              required
              bind:value={userDisplayName}
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="Votre Nom"
            />
          </div>

          <div>
            <label for="email" class="block text-sm font-medium text-gray-700">
              Email (optionnel)
            </label>
            <input
              id="email"
              name="email"
              type="email"
              bind:value={email}
              class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="email@example.com (pour récupération)"
            />
          </div>
        </div>

        {#if error}
          <div class="rounded-md bg-red-50 p-4">
            <p class="text-sm text-red-800">{error}</p>
          </div>
        {/if}

        {#if success}
          <div class="rounded-md bg-green-50 p-4">
            <p class="text-sm text-green-800">{success}</p>
          </div>
        {/if}

        <div>
          <button
            type="submit"
            disabled={loading || !webauthnSupported}
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Enregistrement...' : 'S\'inscrire avec WebAuthn'}
          </button>
        </div>

        <div class="text-center">
          <a href="/auth/login" class="font-medium text-indigo-600 hover:text-indigo-500">
            Déjà un compte ? Se connecter
          </a>
        </div>
      </form>
    {:else if step === 'device-name'}
      <div class="mt-8 space-y-6">
        <div class="rounded-md bg-green-50 p-4 mb-4">
          <p class="text-sm text-green-800">{success}</p>
        </div>

        <div>
          <label for="deviceName" class="block text-sm font-medium text-gray-700">
            Nom de l'appareil
          </label>
          <input
            id="deviceName"
            name="deviceName"
            type="text"
            bind:value={deviceName}
            class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="Mon ordinateur portable"
          />
          <p class="mt-1 text-xs text-gray-500">
            Donnez un nom pour reconnaître cet appareil plus tard
          </p>
        </div>

        {#if error}
          <div class="rounded-md bg-red-50 p-4">
            <p class="text-sm text-red-800">{error}</p>
          </div>
        {/if}

        <p class="text-center text-sm text-gray-600">
          {loading ? 'Finalisation...' : 'Vérification en cours...'}
        </p>
      </div>
    {:else if step === 'success'}
      <div class="mt-8">
        <div class="rounded-md bg-green-50 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-green-800">
                Inscription réussie !
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

