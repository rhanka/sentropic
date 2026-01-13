<script lang="ts">
  import { foldersStore, currentFolderId, fetchFolders } from '$lib/stores/folders';
  import { useCasesStore, fetchUseCases } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { apiDelete } from '$lib/utils/api';
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { adminWorkspaceScope } from '$lib/stores/adminWorkspaceScope';
  import { adminReadOnlyScope } from '$lib/stores/adminWorkspaceScope';
  import { workspaceReadOnlyScope, workspaceScopeHydrated } from '$lib/stores/workspaceScope';
  import { FileText, Trash2, CirclePlus, Lock } from '@lucide/svelte';

  let isLoading = false;
  const HUB_KEY = 'foldersPage';
  let isReadOnly = false;
  $: isReadOnly = $adminReadOnlyScope || $workspaceReadOnlyScope;
  $: showReadOnlyLock = $adminReadOnlyScope || ($workspaceScopeHydrated && $workspaceReadOnlyScope);

  onMount(() => {
    void (async () => {
      await loadFolders();
    })();
    // SSE: folder_update + usecase_update
    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type === 'folder_update') {
        const folderId: string = evt.folderId;
        const data: any = evt.data ?? {};
        if (!folderId) return;
        if (data?.deleted) {
          foldersStore.update((items) => items.filter(f => f.id !== folderId));
          return;
        }
        if (data?.folder) {
          const updated = data.folder;
          foldersStore.update((items) => {
            const idx = items.findIndex(f => f.id === updated.id);
            if (idx === -1) return [updated, ...items];
            const next = [...items];
            next[idx] = { ...next[idx], ...updated };
            return next;
          });
        }
        return;
      }
      if (evt?.type === 'usecase_update') {
        const useCaseId: string = evt.useCaseId;
        const data: any = evt.data ?? {};
        if (!useCaseId) return;
        if (data?.deleted) {
          useCasesStore.update((items) => items.filter(uc => uc.id !== useCaseId));
          return;
        }
        if (data?.useCase) {
          const updated = data.useCase;
          useCasesStore.update((items) => {
            const idx = items.findIndex(uc => uc.id === updated.id);
            if (idx === -1) return [updated, ...items];
            const next = [...items];
            next[idx] = { ...next[idx], ...updated };
            return next;
          });
        }
      }
    });

    // Reload on admin workspace scope change
    let lastScope = $adminWorkspaceScope.selectedId;
    const unsub = adminWorkspaceScope.subscribe((s) => {
      if (s.selectedId !== lastScope) {
        lastScope = s.selectedId;
        currentFolderId.set(null);
        void loadFolders();
      }
    });
    return () => unsub();
  });

  onDestroy(() => {
    streamHub.delete(HUB_KEY);
  });

  const loadFolders = async () => {
    isLoading = true;
    try {
      const folders = await fetchFolders();
      foldersStore.set(folders);
      
      // Charger les cas d'usage pour chaque dossier pour compter
      const useCases = await fetchUseCases();
      useCasesStore.set(useCases);
      
      // Valider que le dossier sélectionné existe toujours
      if ($currentFolderId) {
        const folderExists = folders.some(f => f.id === $currentFolderId);
        if (!folderExists) {
          // Le dossier sauvegardé n'existe plus, réinitialiser
          currentFolderId.set(null);
        }
      }
      
      // Sélectionner le premier dossier s'il n'y en a pas de sélectionné
      if (folders.length > 0 && !$currentFolderId) {
        currentFolderId.set(folders[0].id);
        addToast({
          type: 'info',
          message: `Dossier "${folders[0].name}" sélectionné`
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

  // Polling désactivé: dossiers/cas d'usage se mettent à jour via SSE (folder_update/usecase_update)

  const handleFolderClick = (folderId: string, folderStatus: string) => {
    // Draft: retourner sur la vue "new" (édition brouillon + icônes IA/Créer/Annuler)
    if (folderStatus === 'draft') {
      currentFolderId.set(folderId);
      goto(`/dossier/new?draft=${encodeURIComponent(folderId)}`);
      return;
    }

    // Si le dossier est en cours de génération et n'a pas encore de cas d'usage, ne pas naviguer
    if (folderStatus === 'generating') {
      const folderUseCases = $useCasesStore.filter(uc => uc.folderId === folderId);
      if (folderUseCases.length === 0) {
        return;
      }
    }
    
    // Naviguer vers la vue dossier (qui contient la liste des cas d'usage)
    currentFolderId.set(folderId);
    goto(`/dossiers/${folderId}`);
  };

  const getUseCaseCount = (folderId: string) => {
    return $useCasesStore.filter(uc => uc.folderId === folderId).length;
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce dossier ?')) return;
    
    try {
      await apiDelete(`/folders/${id}`);
      
      // Si le dossier supprimé était le dossier sélectionné, réinitialiser la sélection
      const wasSelected = $currentFolderId === id;
      const remainingFolders = $foldersStore.filter(f => f.id !== id);
      
      foldersStore.update((items) => items.filter(f => f.id !== id));
      
      if (wasSelected) {
        if (remainingFolders.length > 0) {
          // Sélectionner le premier dossier restant
          currentFolderId.set(remainingFolders[0].id);
        } else {
          // Aucun dossier restant, réinitialiser
          currentFolderId.set(null);
        }
      }
      
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
    {#if !isReadOnly}
      <button
        class="rounded p-2 transition text-primary hover:bg-slate-100"
        on:click={() => goto('/dossier/new')}
        title="Nouveau dossier"
        aria-label="Nouveau dossier"
      >
        <CirclePlus class="w-5 h-5" />
      </button>
    {:else if showReadOnlyLock}
      <button
        class="rounded p-2 transition text-slate-400 cursor-not-allowed"
        title="Mode lecture seule : création / suppression désactivées."
        aria-label="Mode lecture seule : création / suppression désactivées."
        type="button"
        disabled
      >
        <Lock class="w-5 h-5" />
      </button>
    {/if}
  </div>
      {#if isLoading}
        <div class="rounded border border-blue-200 bg-blue-50 p-4">
          <p class="text-sm text-blue-700">Chargement des dossiers...</p>
        </div>
      {:else}
        <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {#each $foldersStore as folder}
            {@const isGenerating = folder.status === 'generating'}
            {@const isDraft = folder.status === 'draft'}
            {@const useCaseCount = getUseCaseCount(folder.id)}
            {@const canClick = !isGenerating || useCaseCount > 0}
            <article 
              class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full {canClick ? 'hover:shadow-md cursor-pointer' : 'opacity-60 cursor-not-allowed'}" 
              {...(canClick ? { role: 'button', tabindex: 0 } : {})}
              on:click={() => canClick ? handleFolderClick(folder.id, folder.status || 'completed') : null}
              on:keydown={(e) => {
                if (canClick && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleFolderClick(folder.id, folder.status || 'completed');
                }
              }}
            >
              <!-- Header -->
              <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-green-200 bg-green-50 gap-2 rounded-t-lg">
                <div class="flex-1 min-w-0">
                  <h2 class="text-lg sm:text-xl font-medium truncate {canClick ? 'text-green-800 group-hover:text-green-900 transition-colors' : 'text-slate-400'}">{folder.name}</h2>
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {#if !isReadOnly}
                    <button 
                      class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      on:click|stopPropagation={() => handleDeleteFolder(folder.id)}
                      title="Supprimer"
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  {/if}
                </div>
              </div>
              
              <!-- Body -->
              <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
                {#if folder.description}
                  <p class="text-sm text-slate-600 line-clamp-2 mb-3">{folder.description}</p>
                {/if}
                <div class="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 text-sm text-slate-500">
                  {#if !(isGenerating && useCaseCount === 0)}
                  <span class="flex items-center gap-1 whitespace-nowrap">
                    <FileText class="w-4 h-4 flex-shrink-0" />
                    {useCaseCount} cas d'usage
                  </span>
                  {/if}
                  <div class="flex items-center gap-2 flex-wrap">
                    <!-- badge "Sélectionné" supprimé (affiché dans le footer) -->
                  </div>
                </div>

                {#if isGenerating && useCaseCount === 0}
                  <div class="mt-2">
                    <StreamMessage streamId={`folder_${folder.id}`} status={folder.status} maxHistory={6} />
                  </div>
                {/if}
              </div>
              
              <!-- Footer -->
              <div class="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-100">
                <span class="text-xs text-slate-400 whitespace-nowrap">
                  {#if isDraft}
                    Brouillon
                  {:else}
                    Ouvrir
                  {/if}
                </span>
                <div class="flex items-center gap-2 flex-wrap">
                  {#if folder.organizationName}
                    <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap">
                      {folder.organizationName}
                    </span>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}

  <!-- Création déplacée vers /dossier/new (plus de modal ici) -->
</section>
