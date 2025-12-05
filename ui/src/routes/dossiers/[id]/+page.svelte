<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { foldersStore, currentFolderId } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import { apiDelete } from '$lib/utils/api';

  let folder: any = undefined;
  let isEditing = false;
  let draft: any = {};
  let error = '';

  $: folderId = $page.params.id;

  onMount(async () => {
    await loadFolder();
  });

  const loadFolder = async () => {
    try {
      const folders = $foldersStore;
      folder = folders.find(f => f.id === folderId);
      if (folder) {
        draft = { ...folder };
      } else {
        addToast({ type: 'error', message: 'Dossier non trouvé' });
        error = 'Dossier non trouvé';
      }
    } catch (err) {
      console.error('Failed to fetch folder:', err);
      addToast({ type: 'error', message: 'Erreur lors du chargement du dossier' });
      error = 'Erreur lors du chargement du dossier';
    }
  };

  const handleUpdateFolder = async () => {
    if (!folder || !draft.name?.trim()) return;

    try {
      foldersStore.update(items => items.map(f => f.id === folder.id ? { ...f, ...draft } : f));
      folder = { ...folder, ...draft };
      isEditing = false;
      addToast({ type: 'success', message: 'Dossier mis à jour avec succès !' });
    } catch (err) {
      console.error('Failed to update folder:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la mise à jour' });
    }
  };

  const handleDelete = async () => {
    if (!folder || !confirm('Êtes-vous sûr de vouloir supprimer ce dossier ?')) return;

    try {
      await apiDelete(`/folders/${folder.id}`);
      
      // Si le dossier supprimé était le dossier sélectionné, réinitialiser la sélection
      const wasSelected = $currentFolderId === folder.id;
      const remainingFolders = $foldersStore.filter(f => f.id !== folder.id);
      
      foldersStore.update(items => items.filter(f => f.id !== folder?.id));
      
      if (wasSelected) {
        if (remainingFolders.length > 0) {
          // Sélectionner le premier dossier restant
          currentFolderId.set(remainingFolders[0].id);
        } else {
          // Aucun dossier restant, réinitialiser
          currentFolderId.set(null);
        }
      }
      
      addToast({ type: 'success', message: 'Dossier supprimé avec succès !' });
      goto('/dossiers');
    } catch (err) {
      console.error('Failed to delete folder:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la suppression' });
    }
  };

  const handleCancel = () => {
    if (folder) {
      draft = { ...folder };
    }
    isEditing = false;
    error = '';
  };
</script>

<section class="space-y-6">
  {#if error}
    <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
      {error}
    </div>
  {/if}

  {#if folder}
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-semibold">
            {#if isEditing}
              <input 
                class="text-3xl font-semibold bg-transparent border-b-2 border-blue-500 outline-none"
                bind:value={draft.name}
              />
            {:else}
              {folder.name}
            {/if}
          </h1>
          {#if folder.description || isEditing}
            {#if isEditing}
              <div class="text-lg text-slate-600 mt-1">
                <label for="folder-description-header" class="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea 
                  id="folder-description-header"
                  class="text-lg text-slate-600 bg-transparent border-b border-slate-300 outline-none w-full"
                  placeholder="Description du dossier"
                  bind:value={draft.description}
                  rows="2"
                ></textarea>
              </div>
            {:else}
              <p class="text-lg text-slate-600 mt-1">
                {folder.description}
              </p>
            {/if}
          {/if}
          <p class="text-sm text-slate-500 mt-1">
            ID: {folder.id}
          </p>
        </div>
        
        <div class="flex gap-2">
          {#if isEditing}
            <button 
              class="rounded bg-primary px-4 py-2 text-white"
              on:click={handleUpdateFolder}
              disabled={!draft.name?.trim()}
            >
              Enregistrer
            </button>
            <button 
              class="rounded border border-slate-300 px-4 py-2"
              on:click={handleCancel}
            >
              Annuler
            </button>
          {:else}
            <button 
              class="rounded bg-blue-500 px-4 py-2 text-white"
              on:click={() => isEditing = true}
            >
              Modifier
            </button>
            <button 
              class="rounded bg-red-500 px-4 py-2 text-white"
              on:click={handleDelete}
            >
              Supprimer
            </button>
          {/if}
        </div>
      </div>

      <!-- Informations générales -->
      <div class="grid gap-6 md:grid-cols-2">
        <!-- ID du dossier -->
        <div class="rounded border border-slate-200 bg-white p-4">
          <h3 class="font-semibold text-slate-900 mb-2">Identifiant</h3>
          <p class="text-slate-600 font-mono text-sm">{folder.id}</p>
        </div>

        <!-- Entreprise associée -->
        <div class="rounded border border-slate-200 bg-white p-4">
          <h3 class="font-semibold text-slate-900 mb-2">Entreprise</h3>
          {#if folder.companyId}
            <p class="text-slate-600">ID: {folder.companyId}</p>
          {:else}
            <p class="text-slate-500 italic">Aucune entreprise associée</p>
          {/if}
        </div>
      </div>

      <!-- Description détaillée -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Description</h3>
        {#if isEditing}
          <div>
            <label for="folder-description-detail" class="block text-sm font-medium text-slate-700 mb-1">Description du dossier</label>
            <textarea 
              id="folder-description-detail"
              class="w-full rounded border border-slate-300 p-2 text-sm"
              placeholder="Description détaillée du dossier"
              bind:value={draft.description}
              rows="4"
            ></textarea>
          </div>
        {:else}
          <p class="text-slate-600">{folder.description || 'Aucune description'}</p>
        {/if}
      </div>

      <!-- Cas d'usage associés -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Cas d'usage associés</h3>
        <p class="text-slate-600">Cette fonctionnalité sera implémentée prochainement.</p>
        <div class="mt-4">
          <button class="rounded bg-blue-500 px-4 py-2 text-white text-sm">
            Voir les cas d'usage
          </button>
        </div>
      </div>

      <!-- Métadonnées -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Métadonnées</h3>
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <p class="text-sm text-slate-500">Créé le</p>
            <p class="text-slate-600">Non disponible</p>
          </div>
          <div>
            <p class="text-sm text-slate-500">Modifié le</p>
            <p class="text-slate-600">Non disponible</p>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>


