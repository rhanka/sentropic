<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { addToast } from '$lib/stores/toast';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { currentOrganizationId, organizationsStore, fetchOrganizations } from '$lib/stores/organizations';
  import { createDraftFolder, updateFolder, currentFolderId, type Folder } from '$lib/stores/folders';
  import { apiGet, apiPost } from '$lib/utils/api';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { Brain, Save, Trash2, Loader2, CirclePlus } from '@lucide/svelte';
  import { workspaceReadOnlyScope } from '$lib/stores/workspaceScope';
  import type { Organization } from '$lib/stores/organizations';

  type ModelProviderId = 'openai' | 'gemini';
  interface ModelCatalogProvider {
    provider_id: ModelProviderId;
    label: string;
    status: 'ready' | 'planned';
  }
  interface ModelCatalogModel {
    provider_id: ModelProviderId;
    model_id: string;
    label: string;
    default_contexts: string[];
  }
  interface ModelCatalogPayload {
    providers: ModelCatalogProvider[];
    models: ModelCatalogModel[];
    defaults: {
      provider_id: ModelProviderId;
      model_id: string;
    };
  }
  interface ModelCatalogGroup {
    provider: ModelCatalogProvider;
    models: ModelCatalogModel[];
  }

  let folder: Partial<Folder> = {
    name: '',
    description: '',
    organizationId: null,
  };

  let nbUseCases = 10;
  let isCreatingDraft = false;
  let draftError: string | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let docsUploading = false;
  let hasAnyDoc = false;

  let isSaving = false;
  let isGenerating = false;
  let originalName: string | null = null;
  let originalContext: string | null = null;
  let AUTO_DRAFT_NAME = $_('common.draft');
  $: AUTO_DRAFT_NAME = $_('common.draft');
  let isAutoName = false;
  let isLoadingOrganizations = false;
  let lastOrgIdApplied: string | null = null;
  let orgSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedOrganization: Organization | null = null;
  let selectedOrgHasMatrixTemplate = false;
  let useOrganizationMatrix = true;
  let generateOrganizationMatrix = true;
  let lastMatrixOptionsOrgId: string | null = null;
  let modelCatalog: ModelCatalogPayload = {
    providers: [],
    models: [],
    defaults: { provider_id: 'openai', model_id: 'gpt-4.1-nano' },
  };
  let modelCatalogGroups: ModelCatalogGroup[] = [];
  let selectedGenerationProviderId: ModelProviderId = 'openai';
  let selectedGenerationModelId = 'gpt-4.1-nano';
  let selectedGenerationModelSelectionKey = 'openai::gpt-4.1-nano';
  let isLoadingModelCatalog = false;

  type MatrixModeRequest = 'organization' | 'generate' | 'default';

  const loadOrganizations = async () => {
    isLoadingOrganizations = true;
    try {
      const items = await fetchOrganizations();
      organizationsStore.set(items);
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
      addToast({ type: 'error', message: get(_)('folders.new.errors.loadOrganizations') });
    } finally {
      isLoadingOrganizations = false;
    }
  };

  const modelSelectionKey = (providerId: ModelProviderId, modelId: string) =>
    `${providerId}::${modelId}`;

  const parseModelSelectionKey = (
    rawValue: string,
  ): { providerId: ModelProviderId; modelId: string } | null => {
    const separatorIndex = rawValue.indexOf('::');
    if (separatorIndex <= 0) return null;
    const providerId = rawValue.slice(0, separatorIndex) as ModelProviderId;
    const modelId = rawValue.slice(separatorIndex + 2);
    if (!modelId) return null;
    if (providerId !== 'openai' && providerId !== 'gemini') return null;
    return { providerId, modelId };
  };

  const providerGroupLabel = (provider: ModelCatalogProvider) =>
    provider.status === 'ready'
      ? provider.label
      : `${provider.label} (${provider.status})`;

  const loadModelCatalog = async () => {
    isLoadingModelCatalog = true;
    try {
      modelCatalog = await apiGet<ModelCatalogPayload>('/models/catalog');
      modelCatalogGroups = modelCatalog.providers
        .map((provider) => ({
          provider,
          models: modelCatalog.models.filter(
            (entry) => entry.provider_id === provider.provider_id,
          ),
        }))
        .filter((group) => group.models.length > 0);

      selectedGenerationProviderId =
        modelCatalog.defaults?.provider_id ??
        modelCatalog.providers[0]?.provider_id ??
        'openai';
      selectedGenerationModelId =
        modelCatalog.defaults?.model_id ??
        modelCatalog.models.find(
          (entry) => entry.provider_id === selectedGenerationProviderId,
        )?.model_id ??
        modelCatalog.models[0]?.model_id ??
        selectedGenerationModelId;
      selectedGenerationModelSelectionKey = modelSelectionKey(
        selectedGenerationProviderId,
        selectedGenerationModelId,
      );
    } catch (err) {
      console.error('Failed to load model catalog:', err);
      addToast({
        type: 'error',
        message: get(_)('folders.new.errors.loadModelCatalog'),
      });
    } finally {
      isLoadingModelCatalog = false;
    }
  };

  const handleGenerationModelSelectionChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    const parsed = parseModelSelectionKey(target.value);
    if (!parsed) return;
    selectedGenerationProviderId = parsed.providerId;
    selectedGenerationModelId = parsed.modelId;
    selectedGenerationModelSelectionKey = target.value;
  };

  onMount(() => {
    void loadOrganizations();
    void loadModelCatalog();
    if ($workspaceReadOnlyScope) {
      addToast({ type: 'error', message: get(_)('folders.new.errors.readOnlyCreateDisabled') });
      goto('/folders');
      return;
    }

    // Si arrivée depuis la liste en cliquant sur un brouillon
    void (async () => {
      const urlParams = new URLSearchParams($page.url.search);
      const draftId = urlParams.get('draft');
      if (!draftId) return;
      try {
        const loaded = await apiGet<Folder>(`/folders/${draftId}`);
        folder = { ...folder, ...loaded };
        currentFolderId.set(loaded.id);
        // Reprendre la sélection organisation si présente
        if (loaded.organizationId) currentOrganizationId.set(loaded.organizationId);
        lastOrgIdApplied = loaded.organizationId ?? null;
        // Si le nom est le nom automatique, rester en mode auto-name (save désactivé tant que nom réel pas fourni)
        isAutoName = (loaded.name || '').trim() === AUTO_DRAFT_NAME;
        originalName = loaded.name ?? AUTO_DRAFT_NAME;
        originalContext = loaded.description ?? '';
      } catch (err) {
        console.error('Failed to load draft folder:', err);
        addToast({ type: 'error', message: get(_)('folders.new.errors.draftLoadFailed') });
      }
    })();
  });

  const syncSelectedOrganizationToDraft = () => {
    if (!folder.id) return;
    const nextOrgId = $currentOrganizationId || null;
    if (nextOrgId === lastOrgIdApplied) return;
    if (orgSyncTimer) clearTimeout(orgSyncTimer);
    orgSyncTimer = setTimeout(() => {
      void updateFolder(folder.id as string, { organizationId: nextOrgId || undefined } as any).catch(() => {});
      lastOrgIdApplied = nextOrgId;
      orgSyncTimer = null;
    }, 200);
  };

  const ensureDraftFolder = async (): Promise<string | null> => {
    if (folder.id) return folder.id;
    const name = (folder.name || '').trim();
    const context = (folder.description || '').trim();
    // If the user didn't provide a name yet, create a draft with an internal default name.
    // We'll keep Save disabled until a real name is provided.
    const draftName = name || (context ? AUTO_DRAFT_NAME : AUTO_DRAFT_NAME);
    if (isCreatingDraft) return null;
    isCreatingDraft = true;
    draftError = null;
    try {
      const created = await createDraftFolder({
        name: draftName,
        description: context ? folder.description || undefined : undefined,
        organizationId: $currentOrganizationId || undefined,
      });
      folder = { ...folder, ...created, organizationId: created.organizationId ?? ($currentOrganizationId || null) };
      lastOrgIdApplied = created.organizationId ?? ($currentOrganizationId || null);
      isAutoName = !name;
      originalName = created.name ?? draftName;
      originalContext = created.description ?? (folder.description || '');
      return created.id;
    } catch (err) {
      draftError = err instanceof Error ? err.message : get(_)('folders.new.errors.draftCreateFailed');
      return null;
    } finally {
      isCreatingDraft = false;
    }
  };

  // Create draft lazily once user typed a name (debounced), so documents can be attached before generation.
  $: {
    const name = (folder.name || '').trim();
    const context = (folder.description || '').trim();
    // Draft can be created with either a name OR a context (or later when user wants to add docs).
    if ((name || context) && !folder.id && !isCreatingDraft && !$workspaceReadOnlyScope) {
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        void ensureDraftFolder();
      }, 400);
    }
  }

  const canUseAI = () => {
    const name = isAutoName ? '' : (folder.name || '').trim();
    const context = (folder.description || '').trim();
    return Boolean(name || context || hasAnyDoc || $currentOrganizationId);
  };

  // Derived flags (avoid relying on function calls for UI enablement).
  $: realName = isAutoName ? '' : (folder.name || '').trim();
  $: hasContext = Boolean((folder.description || '').trim());
  $: hasOrganization = Boolean($currentOrganizationId);
  $: canUseAIUi = Boolean(realName || hasContext || hasAnyDoc || hasOrganization);

  const handleSave = async () => {
    if ($workspaceReadOnlyScope) {
      addToast({ type: 'error', message: get(_)('folders.new.errors.readOnlyActionNotAllowed') });
      return;
    }
    if (isAutoName) return;
    if (!folder.name?.trim()) return;

    isSaving = true;
    try {
      const id = await ensureDraftFolder();
      if (!id) throw new Error(get(_)('folders.new.errors.draftCreateFailed'));

      await updateFolder(id, {
        name: folder.name,
        description: folder.description,
        organizationId: $currentOrganizationId || undefined,
        status: 'completed',
      } as any);

      addToast({ type: 'success', message: get(_)('folders.new.toast.created') });
      // UX: retour à la liste des dossiers (pas de vue détail dossier/[id] pour l’instant)
      currentFolderId.set(id);
      goto('/folders');
    } catch (err) {
      console.error('Failed to save folder:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : get(_)('folders.new.errors.create') });
    } finally {
      isSaving = false;
    }
  };

  const handleGenerate = async () => {
    if ($workspaceReadOnlyScope) {
      addToast({ type: 'error', message: get(_)('folders.new.errors.readOnlyActionNotAllowed') });
      return;
    }
    if (!canUseAI()) return;
    if (docsUploading) return;

    isGenerating = true;
    try {
      const id = await ensureDraftFolder();
      if (!id) throw new Error(get(_)('folders.new.errors.draftCreateFailed'));

      const context = (folder.description || '').trim();
      const input =
        context ||
        (hasAnyDoc
          ? get(_)('folders.new.defaultInput.documentsContext')
          : ($currentOrganizationId ? get(_)('folders.new.defaultInput.organizationContext') : ''));
      if (!input) throw new Error(get(_)('folders.new.errors.missingInput'));

      const matrixMode = (() => {
        if (!$currentOrganizationId) return undefined;
        if (selectedOrgHasMatrixTemplate) {
          return useOrganizationMatrix ? ('organization' as MatrixModeRequest) : ('default' as MatrixModeRequest);
        }
        return generateOrganizationMatrix ? ('generate' as MatrixModeRequest) : ('default' as MatrixModeRequest);
      })();

      await apiPost('/use-cases/generate', {
        input,
        folder_id: id,
        use_case_count: nbUseCases,
        organization_id: $currentOrganizationId || undefined,
        matrix_mode: matrixMode,
        model: selectedGenerationModelId || undefined,
      });

      addToast({ type: 'info', message: get(_)('folders.new.toast.generationStarted') });
      // UX: retour à la liste des dossiers, le suivi se fait via SSE sur la carte dossier.
      currentFolderId.set(id);
      goto('/folders');
    } catch (err) {
      console.error('Failed to start generation:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : get(_)('folders.new.errors.generationStart') });
    } finally {
      isGenerating = false;
    }
  };

  const handleCancel = async () => {
    // Keep draft (collaboration): return to list without deletion.
    goto('/folders');
  };

  const handleFieldUpdate = (field: string, value: string) => {
    if (field === 'name') {
      // User started providing a real name -> stop treating it as auto
      if ((value || '').trim()) isAutoName = false;
    }
    folder = { ...folder, [field]: value };
  };

  // Capture initial values once the draft exists (for EditableInput originalValue).
  $: if (folder.id && originalName === null) originalName = folder.name || '';
  $: if (folder.id && originalContext === null) originalContext = folder.description || '';
  $: if (folder.id) syncSelectedOrganizationToDraft();
  $: selectedOrganization = $organizationsStore.find((org) => org.id === ($currentOrganizationId || '')) ?? null;
  $: selectedOrgHasMatrixTemplate = !!selectedOrganization?.hasMatrixTemplate;
  $: {
    const orgId = $currentOrganizationId || null;
    if (orgId !== lastMatrixOptionsOrgId) {
      lastMatrixOptionsOrgId = orgId;
      useOrganizationMatrix = true;
      generateOrganizationMatrix = true;
    }
  }

  $: {
    if (modelCatalog.models.length > 0) {
      const exactMatch = modelCatalog.models.some(
        (entry) =>
          entry.provider_id === selectedGenerationProviderId &&
          entry.model_id === selectedGenerationModelId,
      );
      if (!exactMatch) {
        const providerFallback =
          modelCatalog.models.find(
            (entry) => entry.provider_id === selectedGenerationProviderId,
          ) ?? modelCatalog.models[0];
        selectedGenerationProviderId = providerFallback.provider_id;
        selectedGenerationModelId = providerFallback.model_id;
      }
    }
  }

  $: selectedGenerationModelSelectionKey = modelSelectionKey(
    selectedGenerationProviderId,
    selectedGenerationModelId,
  );

  $: {
    const n = Number(nbUseCases);
    if (!Number.isFinite(n)) {
      nbUseCases = 10;
    } else if (n < 1) {
      nbUseCases = 1;
    } else if (n > 25) {
      nbUseCases = 25;
    }
  }

  onDestroy(() => {
    if (draftTimer) clearTimeout(draftTimer);
    if (orgSyncTimer) clearTimeout(orgSyncTimer);
  });
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold break-words min-w-0">
      <EditableInput
        label={$_('folders.new.nameLabel')}
        value={isAutoName ? '' : (folder.name || '')}
        markdown={false}
        multiline={true}
        placeholder={$_('folders.new.namePlaceholder')}
        locked={$workspaceReadOnlyScope}
        apiEndpoint={folder.id ? `/folders/${folder.id}` : ''}
        fullData={{ name: isAutoName ? AUTO_DRAFT_NAME : (folder.name || '') }}
        originalValue={folder.id ? (originalName ?? (isAutoName ? '' : (folder.name || ''))) : (isAutoName ? '' : (folder.name || ''))}
        changeId={folder.id ? `folder-name-${folder.id}` : ''}
        on:change={(e) => handleFieldUpdate('name', e.detail.value)}
      />
    </h1>
    <div class="flex items-center gap-2">
      <button
        class="rounded p-2 transition text-primary hover:bg-slate-100 disabled:opacity-50"
        on:click={handleGenerate}
        title="IA"
        aria-label="IA"
        disabled={isGenerating || docsUploading || !canUseAIUi}
        type="button"
      >
        {#if isGenerating}
          <Loader2 class="w-5 h-5 animate-spin" />
        {:else}
          <Brain class="w-5 h-5" />
        {/if}
      </button>
      <button
        class="rounded p-2 transition text-primary hover:bg-slate-100 disabled:opacity-50"
        on:click={handleSave}
        title={$_('common.create')}
        aria-label={$_('common.create')}
        disabled={isSaving || isAutoName || !folder.name?.trim()}
        type="button"
      >
        {#if isSaving}
          <Loader2 class="w-5 h-5 animate-spin" />
        {:else}
          <Save class="w-5 h-5" />
        {/if}
      </button>
      <button
        class="rounded p-2 transition text-warning hover:bg-slate-100"
        on:click={handleCancel}
        title={$_('common.cancel')}
        aria-label={$_('common.cancel')}
        type="button"
      >
        <Trash2 class="w-5 h-5" />
      </button>
    </div>
  </div>

  {#if draftError}
    <div class="rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">{draftError}</div>
  {/if}

	  <div class="rounded border border-slate-200 bg-white p-6 space-y-4">
	    <div class="space-y-2">
	      <div class="text-sm font-medium text-slate-700">{$_('folders.new.orgOptional')}</div>
	      {#if isLoadingOrganizations}
	        <div class="w-full rounded border border-slate-300 p-2 bg-slate-50 text-slate-500">
	          {$_('folders.new.loadingOrganizations')}
	        </div>
	      {:else}
	        <select class="w-full rounded border border-slate-300 p-2" bind:value={$currentOrganizationId}>
	          <option value="">{$_('folders.new.unspecified')}</option>
	          {#each $organizationsStore as organization (organization.id)}
	            <option value={organization.id}>{organization.name}</option>
	          {/each}
	        </select>
	        {#if $organizationsStore.length === 0}
	          <p class="text-sm text-slate-500">
	            {$_('folders.new.noOrganizations')}
	            <a href="/organizations" class="text-blue-600 hover:text-blue-800 underline">{$_('folders.new.createOrg')}</a>
	          </p>
	        {/if}
	      {/if}
	    </div>

      {#if $currentOrganizationId}
        <div class="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
          <div class="text-sm font-medium text-slate-700">{$_('folders.new.matrix.title')}</div>
          {#if selectedOrgHasMatrixTemplate}
            <label class="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" class="mt-0.5" bind:checked={useOrganizationMatrix} />
              <span>{$_('folders.new.matrix.useOrganization')}</span>
            </label>
            <p class="text-xs text-slate-500">{$_('folders.new.matrix.useOrganizationHint')}</p>
          {:else}
            <label class="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" class="mt-0.5" bind:checked={generateOrganizationMatrix} />
              <span>{$_('folders.new.matrix.generateOrganization')}</span>
            </label>
            <p class="text-xs text-slate-500">{$_('folders.new.matrix.generateOrganizationHint')}</p>
          {/if}
        </div>
      {/if}

	    <div class="space-y-2">
	      <div class="text-sm font-medium text-slate-700">{$_('folders.new.context')}</div>
	      <EditableInput
	        label=""
	        value={folder.description || ''}
	        markdown={true}
	        placeholder={$_('folders.new.contextPlaceholder')}
	        locked={$workspaceReadOnlyScope}
	        apiEndpoint={folder.id ? `/folders/${folder.id}` : ''}
	        fullData={{ description: folder.description || '' }}
	        originalValue={folder.id ? (originalContext ?? (folder.description || '')) : (folder.description || '')}
	        changeId={folder.id ? `folder-context-${folder.id}` : ''}
        on:change={(e) => handleFieldUpdate('description', e.detail.value)}
      />
    </div>

	    <div class="flex items-center gap-3">
	      <label class="text-sm font-medium text-slate-700" for="nb-usecases">{$_('folders.new.useCaseCount')}</label>
	      <input
	        id="nb-usecases"
	        type="number"
        min="1"
        max="25"
        class="w-20 rounded border border-slate-300 p-2"
	        bind:value={nbUseCases}
	      />
	      <span class="text-xs text-slate-500">{$_('folders.new.default', { values: { count: 10 } })}</span>
	    </div>

      <div class="space-y-2">
        <label class="text-sm font-medium text-slate-700" for="generation-model">
          {$_('folders.new.modelLabel')}
        </label>
        {#if isLoadingModelCatalog}
          <div class="w-full rounded border border-slate-300 p-2 bg-slate-50 text-slate-500">
            {$_('folders.new.loadingModelCatalog')}
          </div>
        {:else}
          <select
            id="generation-model"
            class="w-full rounded border border-slate-300 p-2"
            value={selectedGenerationModelSelectionKey}
            on:change={handleGenerationModelSelectionChange}
          >
            {#if modelCatalogGroups.length === 0}
              <option value={selectedGenerationModelSelectionKey}>
                {selectedGenerationModelId}
              </option>
            {:else}
              {#each modelCatalogGroups as group}
                <optgroup label={providerGroupLabel(group.provider)}>
                  {#each group.models as modelOption}
                    <option value={modelSelectionKey(modelOption.provider_id, modelOption.model_id)}>
                      {modelOption.label}
                    </option>
                  {/each}
                </optgroup>
              {/each}
            {/if}
          </select>
          <p class="text-xs text-slate-500">{$_('folders.new.modelHint')}</p>
        {/if}
      </div>
	  </div>

  <div class="space-y-2">
    {#if folder.id}
      <DocumentsBlock
        contextType="folder"
        contextId={folder.id}
        on:state={(e) => {
          docsUploading = !!e.detail.uploading;
          hasAnyDoc = Array.isArray(e.detail.items) && e.detail.items.length > 0;
        }}
      />
	    {:else}
	      <div class="rounded border border-slate-200 bg-white p-4">
	        <div class="flex items-start justify-between gap-3">
	          <div>
	            <div class="font-semibold">{$_('folders.new.documentsTitle')}</div>
	            <div class="text-sm text-slate-600">
	              {$_('folders.new.documentsHelp')}
	            </div>
	          </div>
	          <button
	            class="rounded p-2 transition text-primary hover:bg-slate-100"
	            on:click={async () => {
	              const id = await ensureDraftFolder();
	              if (!id) addToast({ type: 'error', message: get(_)('folders.new.errors.draftCreateFailed') });
	            }}
	            title={$_('folders.new.addDocument')}
	            aria-label={$_('folders.new.addDocument')}
	            type="button"
	          >
	            <CirclePlus class="w-5 h-5" />
	          </button>
	        </div>
	        <div class="mt-3 text-sm text-slate-500">{$_('folders.new.noDocumentsYet')}</div>
	      </div>
	    {/if}
	  </div>
</section>
