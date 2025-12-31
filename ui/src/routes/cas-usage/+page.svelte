<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} is only used with sanitized HTML produced by renderInlineMarkdown().
  import { useCasesStore, fetchUseCases, deleteUseCase } from '$lib/stores/useCases';
  import { foldersStore, currentFolderId, type Folder } from '$lib/stores/folders';
  import { addToast, removeToast } from '$lib/stores/toast';
  import { apiGet, apiPost } from '$lib/utils/api';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { adminWorkspaceScope } from '$lib/stores/adminWorkspaceScope';
  import { getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';
  import { adminReadOnlyScope } from '$lib/stores/adminWorkspaceScope';
  import { renderInlineMarkdown } from '$lib/utils/markdown';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { Trash2, Star, X, Minus, Loader2 } from '@lucide/svelte';

  let isLoading = false;
  let matrix: MatrixConfig | null = null;
  let currentFolder: Folder | null = null;
  let editedFolderName = '';
  let lastFolderId: string | null = null;
  const HUB_KEY = 'useCasesPage';

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  // Réactivité pour recharger les cas d'usage quand le dossier change
  $: if ($currentFolderId) {
    loadUseCases();
  }

  onMount(() => {
    void (async () => {
      // Vérifier si on doit générer
      const urlParams = new URLSearchParams($page.url.search);
      const shouldGenerate = urlParams.get('generate') === 'true';
      const context = urlParams.get('context');
      const createNewFolder = urlParams.get('createNewFolder') === 'true';
      const organizationId = urlParams.get('organizationId');
      const folderId = urlParams.get('folder');

      // Si un dossier spécifique est demandé, le sélectionner
      if (folderId) {
        currentFolderId.set(folderId);
        // Nettoyer l'URL
        goto('/cas-usage', { replaceState: true });
      }

      if (shouldGenerate && context) {
        // Nettoyer l'URL pour éviter la regénération
        goto('/cas-usage', { replaceState: true });
        if ($adminReadOnlyScope) {
          addToast({ type: 'warning', message: 'Mode lecture seule (workspace partagé) : génération désactivée.' });
          return;
        }
        // Lancer la génération
        await startGeneration(context, createNewFolder, organizationId);
      } else if ($currentFolderId) {
        // Charger les cas existants seulement si un dossier est sélectionné
        await loadUseCases();
      }
    })();

    // SSE: usecase_update + folder_update (pour matrixConfig)
    streamHub.set(HUB_KEY, (evt: any) => {
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
        return;
      }
      if (evt?.type === 'folder_update') {
        const folderId: string = evt.folderId;
        const data: any = evt.data ?? {};
        if (!folderId || folderId !== $currentFolderId) return;
        if (data?.folder?.matrixConfig) {
          matrix = data.folder.matrixConfig;
        }
      }
    });

    // Reload on admin workspace scope change
    let lastScope = $adminWorkspaceScope.selectedId;
    const unsub = adminWorkspaceScope.subscribe((s) => {
      if (s.selectedId !== lastScope) {
        lastScope = s.selectedId;
        currentFolderId.set(null);
        void loadUseCases();
      }
    });
    return () => unsub();
  });

  onDestroy(() => {
    streamHub.delete(HUB_KEY);
  });

  const loadUseCases = async () => {
    isLoading = true;
    try {
      // Charger les cas d'usage depuis l'API
      // Si un dossier est sélectionné, filtrer par ce dossier
      const useCases = await fetchUseCases($currentFolderId || undefined);
      useCasesStore.set(useCases);
      
      // Charger la matrice si on a un dossier sélectionné
      if ($currentFolderId) {
        try {
          const scoped = getScopedWorkspaceIdForAdmin();
          const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
          const folder: Folder = await apiGet(`/folders/${$currentFolderId}${qs}`);
          currentFolder = folder;
          matrix = folder.matrixConfig;

          if (folder.id !== lastFolderId) {
            lastFolderId = folder.id;
            editedFolderName = folder.name || '';
          }

          foldersStore.update((items) => items.map((f) => (f.id === folder.id ? { ...f, ...folder } : f)));
        } catch (err) {
          console.error('Failed to load matrix:', err);
          currentFolder = null;
        }
      } else {
        currentFolder = null;
      }
      
      // Si aucun dossier n'est sélectionné, afficher un message
      if (!$currentFolderId) {
        addToast({
          type: 'info',
          message: 'Veuillez sélectionner un dossier pour voir ses cas d\'usage'
        });
      }
    } catch (error) {
      console.error('Failed to fetch use cases:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des cas d\'usage'
      });
    } finally {
      isLoading = false;
    }
  };

  // Polling désactivé: cas d'usage se mettent à jour via SSE (usecase_update)

  const handleFolderNameSaved = async () => {
    if (!$currentFolderId) return;
    try {
      const scoped = getScopedWorkspaceIdForAdmin();
      const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
      const folder: Folder = await apiGet(`/folders/${$currentFolderId}${qs}`);
      currentFolder = folder;
      editedFolderName = folder.name || '';
      foldersStore.update((items) => items.map((f) => (f.id === folder.id ? { ...f, ...folder } : f)));
    } catch (err) {
      console.error('Failed to reload folder after name saved:', err);
    }
  };

  const startGeneration = async (context: string, createNewFolder: boolean, organizationId: string | null) => {
    let progressToastId = '';
    
    try {
      // Toaster persistant pour le suivi global
      progressToastId = addToast({
        type: 'info',
        message: 'Initialisation de la génération...',
        duration: 0
      });

      // Appeler l'API de génération
      const result = await apiPost('/use-cases/generate', {
        input: context,
        create_new_folder: createNewFolder,
        organization_id: organizationId
      });

      // Mettre à jour le toaster de progression
      removeToast(progressToastId);
      progressToastId = addToast({
        type: 'success',
        message: `${result.message || 'Génération démarrée avec succès'}`,
        duration: 5000
      });

      // Mettre à jour le currentFolderId si un dossier a été créé
      if (result.created_folder_id) {
        currentFolderId.set(result.created_folder_id);
        // Rediriger vers la page dossiers pour voir le statut de génération
        goto('/dossiers');
      } else {
        // Recharger les cas d'usage si aucun nouveau dossier n'a été créé
        await loadUseCases();
      }

    } catch (error) {
      console.error('Failed to generate use cases:', error);
      if (progressToastId) {
        removeToast(progressToastId);
      }
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Erreur lors de la génération'
      });
    }
  };


  const handleUseCaseClick = (useCaseId: string, status: string) => {
    // Si le cas d'usage est en cours de génération ou détail, ne pas naviguer
    if (status === 'generating' || status === 'detailing') {
      return;
    }
    
    // Naviguer vers la vue détaillée du cas d'usage
    goto(`/cas-usage/${useCaseId}`);
  };

  const handleDeleteUseCase = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce cas d\'usage ?')) return;
    
    try {
      await deleteUseCase(id);
      useCasesStore.update((items) => items.filter(uc => uc.id !== id));
      addToast({
        type: 'success',
        message: 'Cas d\'usage supprimé avec succès !'
      });
    } catch (error) {
      console.error('Failed to delete use case:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la suppression'
      });
    }
  };
</script>

<section class="space-y-6">
  {#if $adminReadOnlyScope}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      Mode admin — workspace partagé : <b>lecture seule</b> (suppression / génération désactivées).
    </div>
  {/if}
  {#if $currentFolderId && currentFolder}
    <div class="grid grid-cols-12 gap-4 items-start">
      <div class="col-span-8 min-w-0">
        {#if $adminReadOnlyScope}
          <h1 class="text-3xl font-semibold mb-0 break-words">
            {currentFolder.name || 'Dossier'}
          </h1>
        {:else}
          <h1 class="text-3xl font-semibold mb-0 break-words">
            <EditableInput
              label=""
              value={editedFolderName}
              markdown={false}
              multiline={true}
              apiEndpoint={`/folders/${currentFolder.id}`}
              fullData={{ name: editedFolderName }}
              changeId={`folder-name-${currentFolder.id}`}
              originalValue={currentFolder.name || ''}
              on:change={(e) => editedFolderName = e.detail.value}
              on:saved={handleFolderNameSaved}
            />
          </h1>
        {/if}
      </div>
      <div class="col-span-4 flex items-start justify-end gap-2 flex-wrap pt-1">
        {#if currentFolder.organizationId}
          {@const orgId = currentFolder.organizationId as string}
          <button
            type="button"
            class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
            on:click={() => goto(`/organisations/${orgId}`)}
            title="Voir l'organisation"
          >
            {currentFolder.organizationName || 'Organisation'}
          </button>
        {/if}
        {#if currentFolder.model}
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
            {currentFolder.model}
          </span>
        {/if}
      </div>
    </div>
  {:else}
    <h1 class="text-3xl font-semibold">Cas d'usage</h1>
  {/if}
  
  {#if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">Chargement des cas d'usage...</p>
    </div>
  {/if}
  
  <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {#each $useCasesStore as useCase}
      {@const isDetailing = useCase.status === 'detailing'}
      {@const isDraft = useCase.status === 'draft'}
      {@const isGenerating = useCase.status === 'generating'}
      {@const canClick = !(isDetailing || isGenerating)}
      <article 
        {...(canClick ? { role: 'button', tabindex: 0 } : {})}
        class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full {(isDetailing || isGenerating) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}" 
        on:click={() => canClick && handleUseCaseClick(useCase.id, useCase.status || 'completed')}
        on:keydown={(e) => {
          if (canClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleUseCaseClick(useCase.id, useCase.status || 'completed');
          }
        }}>
        <!-- Header -->
        <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-blue-200 bg-blue-50 gap-2 rounded-t-lg">
          <div class="flex-1 min-w-0">
            <h2 class="text-lg sm:text-xl font-medium truncate {(isDetailing || isGenerating) ? 'text-slate-400' : 'text-blue-800 group-hover:text-blue-900 transition-colors'}">{useCase?.data?.name || useCase?.name || 'Cas d\'usage sans nom'}</h2>
          </div>
          {#if !$adminReadOnlyScope}
            <button 
              class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              on:click|stopPropagation={() => handleDeleteUseCase(useCase.id)}
              title="Supprimer"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          {/if}
        </div>
        
        <!-- Body -->
        <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
          {#if useCase?.data?.description || useCase?.description}
            <div class="text-sm text-slate-600 line-clamp-2 mb-3 break-words">
              {@html renderInlineMarkdown(useCase?.data?.description || useCase?.description || '')}
            </div>
          {/if}
          {#if isDetailing || isGenerating}
            <StreamMessage streamId={`usecase_${useCase.id}`} status={useCase.status} maxHistory={6} />
          {:else}
          <div class="flex flex-col sm:flex-row gap-2 sm:gap-4 text-sm text-slate-500">
            <div class="flex items-center gap-1 flex-wrap">
              <span class="whitespace-nowrap">Valeur:</span>
              {#if matrix}
                {@const valueScores = useCase?.data?.valueScores || useCase?.valueScores}
                {@const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores}
                {#if valueScores && complexityScores}
                  {@const calculatedScores = calculateUseCaseScores(matrix, valueScores, complexityScores)}
                  {@const valueStars = calculatedScores.valueStars}
                <div class="flex items-center gap-0.5">
                  {#each range(5) as i (i)}
                    {#if i < valueStars}
                      <Star class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-400 fill-yellow-400 flex-shrink-0" />
                    {:else}
                      <Star class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 flex-shrink-0" />
                    {/if}
                  {/each}
                </div>
                {:else}
                  <span class="text-gray-400">N/A</span>
                {/if}
              {:else}
                <span class="text-gray-400">N/A</span>
              {/if}
            </div>
            <div class="flex items-center gap-1 flex-wrap">
              <span class="whitespace-nowrap">Complexité:</span>
              {#if matrix}
                {@const valueScores = useCase?.data?.valueScores || useCase?.valueScores}
                {@const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores}
                {#if valueScores && complexityScores}
                  {@const calculatedScores = calculateUseCaseScores(matrix, valueScores, complexityScores)}
                  {@const complexityStars = calculatedScores.complexityStars}
                <div class="flex items-center gap-0.5">
                  {#each range(5) as i (i)}
                    {#if i < complexityStars}
                      <X class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500 flex-shrink-0" />
                    {:else}
                      <Minus class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 flex-shrink-0" />
                    {/if}
                  {/each}
                </div>
                {:else}
                  <span class="text-gray-400">N/A</span>
                {/if}
              {:else}
                <span class="text-gray-400">N/A</span>
              {/if}
            </div>
          </div>
          {/if}
        </div>
        
        <!-- Footer -->
        <div class="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-100">
          <span class="text-xs text-slate-400 whitespace-nowrap">
            {#if isDetailing}
              Détail en cours...
            {:else if isGenerating}
              Génération en cours...
            {:else if isDraft}
              Brouillon
            {:else}
              Cliquez pour voir les détails
            {/if}
          </span>
          <div class="flex items-center gap-2 flex-wrap">
            {#if useCase.model}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">
                {useCase.model}
              </span>
            {/if}
            {#if isDetailing}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 whitespace-nowrap">
                <Loader2 class="w-3 h-3 mr-1 animate-spin flex-shrink-0" />
                Détail en cours
              </span>
            {:else if isGenerating}
              <!-- badge supprimé (streamMessage affiche le suivi) -->
            {:else if isDraft}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">
                Brouillon
              </span>
            {/if}
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>
