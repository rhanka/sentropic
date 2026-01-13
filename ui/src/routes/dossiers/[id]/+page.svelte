<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} is only used with sanitized HTML produced by renderInlineMarkdown().
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  import { foldersStore, currentFolderId, type Folder } from '$lib/stores/folders';
  import { useCasesStore, fetchUseCases, deleteUseCase } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { apiGet } from '$lib/utils/api';

  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { adminReadOnlyScope, getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';
  import { workspaceReadOnlyScope, workspaceScopeHydrated } from '$lib/stores/workspaceScope';

  import type { MatrixConfig } from '$lib/types/matrix';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import { renderInlineMarkdown } from '$lib/utils/markdown';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import { Trash2, Star, X, Minus, Loader2, Lock } from '@lucide/svelte';

  let isLoading = false;
  let matrix: MatrixConfig | null = null;
  let currentFolder: Folder | null = null;
  let editedFolderName = '';
  let editedContext = '';
  let lastFolderId: string | null = null;
  const HUB_KEY = 'folderDetailUseCases';
  let isReadOnly = false;
  $: isReadOnly = $adminReadOnlyScope || $workspaceReadOnlyScope;
  $: showReadOnlyLock = $adminReadOnlyScope || ($workspaceScopeHydrated && $workspaceReadOnlyScope);

  $: folderId = $page.params.id;

  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const loadUseCases = async () => {
    isLoading = true;
    try {
      const useCases = await fetchUseCases(folderId);
      useCasesStore.set(useCases);

      const scoped = getScopedWorkspaceIdForAdmin();
      const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
      const folder: Folder = await apiGet(`/folders/${folderId}${qs}`);
      currentFolder = folder;
      matrix = folder.matrixConfig;

      if (folder.id !== lastFolderId) {
        lastFolderId = folder.id;
        editedFolderName = folder.name || '';
        editedContext = folder.description || '';
      }

      foldersStore.update((items) => items.map((f) => (f.id === folder.id ? { ...f, ...folder } : f)));
    } catch (error) {
      console.error('Failed to load folder/use cases:', error);
      addToast({ type: 'error', message: 'Erreur lors du chargement du dossier' });
      currentFolder = null;
    } finally {
      isLoading = false;
    }
  };

  const handleFolderNameSaved = async () => {
    try {
      const scoped = getScopedWorkspaceIdForAdmin();
      const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
      const folder: Folder = await apiGet(`/folders/${folderId}${qs}`);
      currentFolder = folder;
      editedFolderName = folder.name || '';
      foldersStore.update((items) => items.map((f) => (f.id === folder.id ? { ...f, ...folder } : f)));
    } catch {
      // ignore
    }
  };

  const handleUseCaseClick = (useCaseId: string, status: string) => {
    if (status === 'generating' || status === 'detailing') return;
    goto(`/cas-usage/${useCaseId}`);
  };

  const handleDeleteUseCase = async (id: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce cas d'usage ?")) return;
    try {
      await deleteUseCase(id);
      useCasesStore.update((items) => items.filter((uc) => uc.id !== id));
      addToast({ type: 'success', message: "Cas d'usage supprimé avec succès !" });
    } catch (error) {
      console.error('Failed to delete use case:', error);
      const anyErr = error as any;
      if (anyErr?.status === 403) {
        addToast({ type: 'error', message: 'Action non autorisée (mode lecture seule).' });
      } else {
        addToast({ type: 'error', message: 'Erreur lors de la suppression' });
      }
    }
  };

  onMount(() => {
    currentFolderId.set(folderId);
    void loadUseCases();

    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type === 'usecase_update') {
        const useCaseId: string = evt.useCaseId;
        const data: any = evt.data ?? {};
        if (!useCaseId) return;
        if (data?.deleted) {
          useCasesStore.update((items) => items.filter((uc) => uc.id !== useCaseId));
          return;
        }
        if (data?.useCase) {
          const updated = data.useCase;
          useCasesStore.update((items) => {
            const idx = items.findIndex((uc) => uc.id === updated.id);
            if (idx === -1) return [updated, ...items];
            const next = [...items];
            next[idx] = { ...next[idx], ...updated };
            return next;
          });
        }
        return;
      }
      if (evt?.type === 'folder_update') {
        const fId: string = evt.folderId;
        const data: any = evt.data ?? {};
        if (!fId || fId !== folderId) return;
        if (data?.folder?.matrixConfig) {
          matrix = data.folder.matrixConfig;
        }
        if (data?.folder) {
          currentFolder = { ...(currentFolder as any), ...(data.folder as any) };
        }
      }
    });
  });

  onDestroy(() => {
    streamHub.delete(HUB_KEY);
  });
</script>

<section class="space-y-6">
  {#if currentFolder}
    <div class="grid grid-cols-12 gap-4 items-start">
      <div class="col-span-8 min-w-0">
        {#if isReadOnly}
          <h1 class="text-3xl font-semibold mb-0 break-words">{currentFolder.name || 'Dossier'}</h1>
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
              on:change={(e) => (editedFolderName = e.detail.value)}
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
        {#if showReadOnlyLock}
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
    </div>

    <!-- Contexte (entre le titre et le bloc documents) -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <div class="text-sm font-medium text-slate-700 mb-2">Contexte</div>
      <EditableInput
        label=""
        value={editedContext}
        markdown={true}
        placeholder="Décrire le contexte métier et les objectifs…"
        apiEndpoint={`/folders/${currentFolder.id}`}
        fullData={{ description: editedContext }}
        originalValue={currentFolder.description || ''}
        changeId={`folder-context-${currentFolder.id}`}
        on:change={(e) => (editedContext = e.detail.value)}
        locked={isReadOnly}
      />
    </div>

    <DocumentsBlock contextType="folder" contextId={currentFolder.id} />
  {:else}
    <h1 class="text-3xl font-semibold">Dossier</h1>
  {/if}

  {#if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">Chargement des cas d'usage...</p>
    </div>
  {/if}

  <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {#each $useCasesStore.filter((uc) => uc.folderId === folderId) as useCase}
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
        }}
      >
        <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-blue-200 bg-blue-50 gap-2 rounded-t-lg">
          <div class="flex-1 min-w-0">
            <h2
              class="text-lg sm:text-xl font-medium truncate {(isDetailing || isGenerating) ? 'text-slate-400' : 'text-blue-800 group-hover:text-blue-900 transition-colors'}"
            >
              {useCase?.data?.name || useCase?.name || "Cas d'usage sans nom"}
            </h2>
          </div>
          {#if !isReadOnly}
            <button
              class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              on:click|stopPropagation={() => handleDeleteUseCase(useCase.id)}
              title="Supprimer"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          {/if}
        </div>

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


