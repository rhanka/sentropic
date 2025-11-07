<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
import { apiPost } from '$lib/utils/api';
import { setUser } from '$lib/stores/session';

  let loading = true;
  let error = '';
  let success = false;

  onMount(async () => {
    const token = $page.url.searchParams.get('token');

    if (!token) {
      error = 'Token manquant dans l\'URL';
      loading = false;
      return;
    }

    try {
      // Verify magic link token
      const data = await apiPost('/auth/magic-link/verify', { token });

      // Store session info (optional, cookies are set by server)
      if (data.sessionToken) {
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('refreshToken', data.refreshToken);
      }

      if (data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.displayName ?? null,
          role: data.user.role ?? 'guest',
        });
      }

      success = true;

      // Redirect to dashboard after 1 second
      setTimeout(() => {
        goto('/dashboard');
      }, 1000);
    } catch (err: any) {
      error = err.message || 'Erreur lors de la vérification du lien magique';
      loading = false;
    }
  });
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="max-w-md w-full space-y-8">
    <div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        Vérification du lien magique
      </h2>
    </div>

    <div class="mt-8">
      {#if loading && !error}
        <div class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p class="mt-4 text-sm text-gray-600">Vérification en cours...</p>
        </div>
      {:else if success}
        <div class="rounded-md bg-green-50 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-green-800">
                Connexion réussie !
              </h3>
              <div class="mt-2 text-sm text-green-700">
                <p>Redirection vers le tableau de bord...</p>
              </div>
            </div>
          </div>
        </div>
      {:else if error}
        <div class="rounded-md bg-red-50 p-4">
          <div class="flex">
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">
                Erreur de vérification
              </h3>
              <div class="mt-2 text-sm text-red-700">
                <p>{error}</p>
              </div>
            </div>
          </div>
          <div class="mt-4">
            <a
              href="/auth/login"
              class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200"
            >
              Retour à la connexion
            </a>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

