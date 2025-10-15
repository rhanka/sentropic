<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE_URL } from '$lib/config';
  import { isAuthenticated, session } from '$lib/stores/session';
  import { goto } from '$app/navigation';

  interface Credential {
    id: string;
    credentialId: string;
    deviceName: string;
    uv: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }

  let credentials: Credential[] = [];
  let loading = true;
  let error = '';
  let editingId: string | null = null;
  let editingName = '';

  onMount(async () => {
    if (!$isAuthenticated) {
      goto('/auth/login?returnUrl=/auth/devices');
      return;
    }

    await loadCredentials();
  });

  async function loadCredentials() {
    loading = true;
    error = '';

    try {
      const res = await fetch(`${API_BASE_URL}/auth/credentials`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to load credentials');
      }

      const data = await res.json();
      credentials = data.credentials;
    } catch (err: any) {
      error = err.message || 'Erreur lors du chargement des appareils';
    } finally {
      loading = false;
    }
  }

  function startEdit(credential: Credential) {
    editingId = credential.id;
    editingName = credential.deviceName;
  }

  function cancelEdit() {
    editingId = null;
    editingName = '';
  }

  async function saveDeviceName(credentialId: string) {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/credentials/${credentialId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ deviceName: editingName }),
      });

      if (!res.ok) {
        throw new Error('Failed to update device name');
      }

      await loadCredentials();
      editingId = null;
      editingName = '';
    } catch (err: any) {
      error = err.message || 'Erreur lors de la mise à jour';
    }
  }

  async function revokeCredential(credentialId: string, deviceName: string) {
    if (!confirm(`Êtes-vous sûr de vouloir révoquer l'appareil "${deviceName}" ? Vous ne pourrez plus vous connecter avec cet appareil.`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/auth/credentials/${credentialId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to revoke credential');
      }

      await loadCredentials();
    } catch (err: any) {
      error = err.message || 'Erreur lors de la révocation';
    }
  }

  function formatDate(dateString: string | null): string {
    if (!dateString) return 'Jamais utilisé';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    
    return date.toLocaleDateString('fr-FR');
  }
</script>

<div class="max-w-4xl mx-auto">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-gray-900">Mes appareils</h1>
    <p class="mt-2 text-sm text-gray-600">
      Gérez les appareils enregistrés pour l'authentification WebAuthn
    </p>
  </div>

  {#if error}
    <div class="rounded-md bg-red-50 p-4 mb-6">
      <p class="text-sm text-red-800">{error}</p>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      <p class="mt-4 text-sm text-gray-600">Chargement...</p>
    </div>
  {:else if credentials.length === 0}
    <div class="text-center py-12 bg-white rounded-lg shadow">
      <p class="text-gray-600">Aucun appareil enregistré</p>
      <a
        href="/auth/register"
        class="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
      >
        Enregistrer un appareil
      </a>
    </div>
  {:else}
    <div class="bg-white shadow rounded-lg overflow-hidden">
      <ul class="divide-y divide-gray-200">
        {#each credentials as credential (credential.id)}
          <li class="p-6 hover:bg-gray-50 transition">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                {#if editingId === credential.id}
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={editingName}
                      class="px-3 py-1 border border-gray-300 rounded-md text-sm"
                      on:keydown={(e) => {
                        if (e.key === 'Enter') saveDeviceName(credential.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button
                      on:click={() => saveDeviceName(credential.id)}
                      class="px-3 py-1 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
                    >
                      Sauvegarder
                    </button>
                    <button
                      on:click={cancelEdit}
                      class="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
                    >
                      Annuler
                    </button>
                  </div>
                {:else}
                  <h3 class="text-lg font-medium text-gray-900">{credential.deviceName}</h3>
                {/if}
                <div class="mt-1 flex items-center gap-4 text-sm text-gray-500">
                  <span>Ajouté le {new Date(credential.createdAt).toLocaleDateString('fr-FR')}</span>
                  {#if credential.lastUsedAt}
                    <span>Dernière utilisation : {formatDate(credential.lastUsedAt)}</span>
                  {/if}
                  {#if credential.uv}
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      UV activée
                    </span>
                  {/if}
                </div>
              </div>

              <div class="flex items-center gap-2">
                {#if editingId !== credential.id}
                  <button
                    on:click={() => startEdit(credential)}
                    class="px-3 py-1 text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    Renommer
                  </button>
                  <button
                    on:click={() => revokeCredential(credential.id, credential.deviceName)}
                    class="px-3 py-1 text-sm text-red-600 hover:text-red-800"
                  >
                    Révoquer
                  </button>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </div>

    <div class="mt-6 text-center">
      <a
        href="/auth/register"
        class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200"
      >
        Ajouter un nouvel appareil
      </a>
    </div>
  {/if}
</div>

