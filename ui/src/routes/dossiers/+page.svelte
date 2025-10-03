<script lang="ts">
  import { foldersStore, currentFolderId, fetchFolders } from '$lib/stores/folders';
  import { useCasesStore, fetchUseCases } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { onMount } from 'svelte';

  let showCreate = false;
  let name = '';
  let description = '';
  let isLoading = false;

  onMount(async () => {
    await loadFolders();
  });

  const loadFolders = async () => {
    isLoading = true;
    try {
      const folders = await fetchFolders();
      foldersStore.set(folders);
      
      // Charger les cas d'usage pour chaque dossier pour compter
      const useCases = await fetchUseCases();
      useCasesStore.set(useCases);
      
      // Sélectionner automatiquement le premier dossier s'il n'y en a pas de sélectionné
      if (folders.length > 0 && !$currentFolderId) {
        currentFolderId.set(folders[0].id);
        addToast({
          type: 'info',
          message: `Dossier "${folders[0].name}" sélectionné automatiquement`
        });
      }
    } catch (error) {
      console.error('Failed to load folders:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des dossiers'
      });
    } finally {
      isLoading = false;
    }
  };

  const getUseCaseCount = (folderId: string) => {
    return $useCasesStore.filter(uc => uc.folderId === folderId).length;
  };

  const selectFolder = (folderId: string) => {
    currentFolderId.set(folderId);
    addToast({
      type: 'success',
      message: 'Dossier sélectionné'
    });
  };

  const createFolder = async () => {
    if (!name.trim()) {
      addToast({
        type: 'error',
        message: 'Veuillez saisir un nom pour le dossier'
      });
      return;
    }
    
    try {
      const response = await fetch('http://localhost:8787/api/v1/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        throw new Error('Failed to create folder');
      }

      const newFolder = await response.json();
      foldersStore.update((items) => [...items, newFolder]);
      name = '';
      description = '';
      showCreate = false;
      addToast({
        type: 'success',
        message: 'Dossier créé avec succès !'
      });
    } catch (error) {
      console.error('Failed to create folder:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la création du dossier'
      });
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce dossier ?')) return;
    
    try {
      const response = await fetch(`http://localhost:8787/api/v1/folders/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete folder');
      }

      foldersStore.update((items) => items.filter(f => f.id !== id));
      addToast({
        type: 'success',
        message: 'Dossier supprimé avec succès !'
      });
    } catch (error) {
      console.error('Failed to delete folder:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la suppression du dossier'
      });
    }
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Dossiers</h1>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={() => (showCreate = true)}>
      Nouveau dossier
    </button>
  </div>
      {#if isLoading}
        <div class="rounded border border-blue-200 bg-blue-50 p-4">
          <p class="text-sm text-blue-700">Chargement des dossiers...</p>
        </div>
      {:else}
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {#each $foldersStore as folder}
            <article class="rounded border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer group" 
                     on:click={() => selectFolder(folder.id)}>
              <div class="flex justify-between items-start">
                <div class="flex-1">
                  <h2 class="text-xl font-medium group-hover:text-blue-600 transition-colors">{folder.name}</h2>
                  {#if folder.description}
                    <p class="mt-1 text-sm text-slate-600 line-clamp-2">{folder.description}</p>
                  {/if}
                  <div class="mt-2 flex items-center gap-4 text-sm text-slate-500">
                    <span class="flex items-center gap-1">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                      </svg>
                      {getUseCaseCount(folder.id)} cas d'usage
                    </span>
                    {#if $currentFolderId === folder.id}
                      <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Sélectionné
                      </span>
                    {/if}
                  </div>
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    class="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                    on:click|stopPropagation={() => window.location.href = `/cas-usage?folder=${folder.id}`}
                    title="Voir les cas d'usage"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                  </button>
                  <button 
                    class="p-1 text-green-500 hover:text-green-700 hover:bg-green-50 rounded"
                    on:click|stopPropagation={() => window.location.href = `/matrice`}
                    title="Voir la matrice"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                    </svg>
                  </button>
                  <button 
                    class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    on:click|stopPropagation={() => handleDeleteFolder(folder.id)}
                    title="Supprimer"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <span class="text-xs text-slate-400">
                  Cliquez pour sélectionner
                </span>
                <div class="flex items-center gap-2">
                  <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Dossier
                  </span>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}

  {#if showCreate}
    <div class="fixed inset-0 bg-slate-900/40">
      <div class="mx-auto mt-24 max-w-lg rounded bg-white p-6 shadow-lg">
        <h2 class="text-lg font-semibold">Créer un dossier</h2>
        <div class="mt-4 space-y-3">
          <input
            class="w-full rounded border border-slate-300 p-2"
            placeholder="Nom du dossier"
            bind:value={name}
          />
          <textarea
            class="h-32 w-full rounded border border-slate-300 p-2"
            placeholder="Description"
            bind:value={description}
          ></textarea>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded border border-slate-200 px-4 py-2" on:click={() => (showCreate = false)}>
            Annuler
          </button>
          <button class="rounded bg-primary px-4 py-2 text-white" on:click={createFolder}>
            Créer
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
