<script lang="ts">
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost, apiPut } from '$lib/utils/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { session } from '$lib/stores/session';
  import { deactivateAccount, deleteAccount, loadMe, me } from '$lib/stores/me';
  import {
    fetchChromeExtensionDownloadMetadata,
    getChromeExtensionDownloadErrorMessage,
    type ChromeExtensionDownloadMetadata,
  } from '$lib/utils/chrome-extension-download';
  import { emitUserAISettingsUpdated } from '$lib/utils/user-ai-settings-events';
  import AdminUsersPanel from '$lib/components/AdminUsersPanel.svelte';
  import WorkspaceSettingsPanel from '$lib/components/WorkspaceSettingsPanel.svelte';
  import { Download, Edit, X } from '@lucide/svelte';

  interface Prompt {
    id: string;
    name: string;
    description: string;
    content: string;
    variables: string[];
  }

  interface CatalogProvider {
    provider_id: 'openai' | 'gemini';
    label: string;
    status: 'ready' | 'planned';
  }

  interface CatalogModel {
    provider_id: 'openai' | 'gemini';
    model_id: string;
    label: string;
    default_contexts: string[];
  }

  interface ModelCatalogPayload {
    providers: CatalogProvider[];
    models: CatalogModel[];
    defaults: {
      provider_id: 'openai' | 'gemini';
      model_id: string;
    };
  }

  interface ModelCatalogGroup {
    provider: CatalogProvider;
    models: CatalogModel[];
  }

  let isResetting = false;
  let prompts: Prompt[] = [];
  let selectedPrompt: Prompt | null = null;
  let showPromptEditor = false;
  let promptContent = '';
  let promptName = '';
  let promptDescription = '';
  let promptVariables: string[] = [];
  let chromeExtensionDownloadMetadata: ChromeExtensionDownloadMetadata | null = null;
  let chromeExtensionDownloadError = '';
  let isLoadingChromeExtensionDownload = false;
  
  // Configuration IA
  let aiSettings = {
    concurrency: 10,
    publishingConcurrency: 5,
    defaultProviderId: 'openai' as 'openai' | 'gemini',
    defaultModel: 'gpt-5.2',
    processingInterval: 1000
  };
  let modelCatalog: ModelCatalogPayload = {
    providers: [],
    models: [],
    defaults: { provider_id: 'openai', model_id: 'gpt-4.1-nano' }
  };
  let modelCatalogGroups: ModelCatalogGroup[] = [];
  let isLoadingAISettings = false;
  let isLoadingModelCatalog = false;
  let isSavingAISettings = false;
  let userAISettings = {
    defaultProviderId: 'openai' as 'openai' | 'gemini',
    defaultModel: 'gpt-4.1-nano',
  };
  let isLoadingUserAISettings = false;
  let isSavingUserAISettings = false;

  const modelSelectionKey = (providerId: 'openai' | 'gemini', modelId: string) =>
    `${providerId}::${modelId}`;

  const parseModelSelectionKey = (
    rawKey: string
  ): { providerId: 'openai' | 'gemini'; modelId: string } | null => {
    const separatorIndex = rawKey.indexOf('::');
    if (separatorIndex <= 0) return null;
    const providerCandidate = rawKey.slice(0, separatorIndex);
    const modelId = rawKey.slice(separatorIndex + 2);
    if ((providerCandidate !== 'openai' && providerCandidate !== 'gemini') || !modelId) {
      return null;
    }
    return { providerId: providerCandidate, modelId };
  };
  
  // Gestion de la queue
  let queueStats = {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0
  };
  let isPurgingQueue = false;

  onMount(async () => {
    await loadMe();
    await loadChromeExtensionDownloadMetadata();
    await loadModelCatalog();
    await loadUserAISettings();
    if (isAdmin()) {
      await loadPrompts();
      await loadAISettings();
      await loadQueueStats();
    }
  });

  const isAdmin = () => {
    const s = get(session);
    return s.user?.role === 'admin_app' || s.user?.role === 'admin_org';
  };

  const isAdminApp = () => {
    const s = get(session);
    return s.user?.role === 'admin_app';
  };


  let deleting = false;
  let deactivating = false;
  // Workspace management UI is handled by WorkspaceSettingsPanel (collaboration Lot 1)

  const handleDeactivate = async () => {
    if (!confirm(get(_)('settings.confirmDeactivate'))) return;
    deactivating = true;
    try {
      await deactivateAccount();
      addToast({ type: 'success', message: get(_)('settings.toast.deactivatedLogout') });
      await session.logout();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('settings.errors.deactivate') });
    } finally {
      deactivating = false;
    }
  };

  const handleDelete = async () => {
    if (!confirm(get(_)('settings.confirmDeleteAccount'))) return;
    deleting = true;
    try {
      await deleteAccount();
      addToast({ type: 'success', message: get(_)('settings.toast.deleted') });
      await session.logout();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('settings.errors.delete') });
    } finally {
      deleting = false;
    }
  };

  const loadPrompts = async () => {
    try {
      const data = await apiGet<{ prompts: Prompt[] }>('/prompts');
      prompts = data.prompts;
    } catch (error) {
      console.error('Failed to load prompts:', error);
    }
  };

  const loadChromeExtensionDownloadMetadata = async () => {
    isLoadingChromeExtensionDownload = true;
    chromeExtensionDownloadError = '';

    try {
      chromeExtensionDownloadMetadata = await fetchChromeExtensionDownloadMetadata();
    } catch (error) {
      console.error('Failed to load chrome extension metadata:', error);
      chromeExtensionDownloadMetadata = null;
      chromeExtensionDownloadError = getChromeExtensionDownloadErrorMessage(
        error,
        get(_)('settings.chromeExtension.errors.load')
      );
    } finally {
      isLoadingChromeExtensionDownload = false;
    }
  };

  const openPromptEditor = (prompt: Prompt) => {
    selectedPrompt = prompt;
    promptName = prompt.name;
    promptDescription = prompt.description;
    promptContent = prompt.content;
    promptVariables = [...prompt.variables];
    showPromptEditor = true;
  };

  const extractVariablesFromContent = (content: string): string[] => {
    const matches = content.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      return matches.map((match: string) => match.replace(/\{\{|\}\}/g, '')).filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
    }
    return [];
  };

  $: if (promptContent) {
    promptVariables = extractVariablesFromContent(promptContent);
  }

  const savePrompt = async () => {
    if (!selectedPrompt) return;

    try {
      const updatedPrompt: Prompt = {
        ...selectedPrompt,
        content: promptContent,
        variables: promptVariables
      };

      const updatedPrompts = prompts.map((p: Prompt) => 
        p.id === updatedPrompt.id ? updatedPrompt : p
      );

      await apiPut('/prompts', { prompts: updatedPrompts });
      prompts = updatedPrompts;
      showPromptEditor = false;
      addToast({
        type: 'success',
        message: get(_)('settings.prompts.toast.updated')
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: get(_)('settings.prompts.errors.save')
      });
    }
  };

  const closePromptEditor = () => {
    showPromptEditor = false;
    selectedPrompt = null;
  };

  // Fonctions pour la configuration IA
  const loadAISettings = async () => {
    isLoadingAISettings = true;
    try {
      aiSettings = await apiGet('/ai-settings');
    } catch (error) {
      console.error('Failed to load AI settings:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.ai.errors.load')
      });
    } finally {
      isLoadingAISettings = false;
    }
  };

  const loadUserAISettings = async () => {
    isLoadingUserAISettings = true;
    try {
      const payload = await apiGet<{
        defaultProviderId: 'openai' | 'gemini';
        defaultModel: string;
      }>('/me/ai-settings');
      userAISettings.defaultProviderId = payload.defaultProviderId;
      userAISettings.defaultModel = payload.defaultModel;
    } catch (error) {
      console.error('Failed to load user AI settings:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.userAi.errors.load')
      });
    } finally {
      isLoadingUserAISettings = false;
    }
  };

  const loadModelCatalog = async () => {
    isLoadingModelCatalog = true;
    try {
      modelCatalog = await apiGet<ModelCatalogPayload>('/models/catalog');
    } catch (error) {
      console.error('Failed to load model catalog:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.ai.errors.load')
      });
    } finally {
      isLoadingModelCatalog = false;
    }
  };

  $: modelCatalogGroups = modelCatalog.providers
    .map((provider) => ({
      provider,
      models: modelCatalog.models.filter((entry) => entry.provider_id === provider.provider_id)
    }))
    .filter((group) => group.models.length > 0);

  $: {
    if (modelCatalog.models.length > 0) {
      const exactMatch = modelCatalog.models.find(
        (entry) =>
          entry.provider_id === aiSettings.defaultProviderId &&
          entry.model_id === aiSettings.defaultModel
      );
      if (!exactMatch) {
        const providerFallback =
          modelCatalog.models.find((entry) => entry.provider_id === aiSettings.defaultProviderId) ??
          modelCatalog.models[0];
        aiSettings.defaultProviderId = providerFallback.provider_id;
        aiSettings.defaultModel = providerFallback.model_id;
      }
    }
  }

  $: {
    if (modelCatalog.models.length > 0) {
      const exactMatch = modelCatalog.models.find(
        (entry) =>
          entry.provider_id === userAISettings.defaultProviderId &&
          entry.model_id === userAISettings.defaultModel
      );
      if (!exactMatch) {
        const providerFallback =
          modelCatalog.models.find(
            (entry) => entry.provider_id === userAISettings.defaultProviderId
          ) ?? modelCatalog.models[0];
        userAISettings.defaultProviderId = providerFallback.provider_id;
        userAISettings.defaultModel = providerFallback.model_id;
      }
    }
  }

  const handleDefaultModelSelectionChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    const parsed = parseModelSelectionKey(target.value);
    if (!parsed) return;
    aiSettings.defaultProviderId = parsed.providerId;
    aiSettings.defaultModel = parsed.modelId;
  };

  const handleUserDefaultModelSelectionChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    const parsed = parseModelSelectionKey(target.value);
    if (!parsed) return;
    userAISettings.defaultProviderId = parsed.providerId;
    userAISettings.defaultModel = parsed.modelId;
  };

  const selectedDefaultModelSelectionKey = () => {
    if (!aiSettings.defaultModel) return '';
    return modelSelectionKey(aiSettings.defaultProviderId, aiSettings.defaultModel);
  };

  const selectedUserDefaultModelSelectionKey = () => {
    if (!userAISettings.defaultModel) return '';
    return modelSelectionKey(
      userAISettings.defaultProviderId,
      userAISettings.defaultModel
    );
  };

  const providerGroupLabel = (provider: CatalogProvider) => {
    return provider.status === 'ready'
      ? provider.label
      : `${provider.label} (${provider.status})`;
  };

  const fallbackDefaultModelOption = () => {
    return modelCatalog.models.find((entry) => entry.model_id === aiSettings.defaultModel);
  };

  const fallbackUserDefaultModelOption = () => {
    return modelCatalog.models.find(
      (entry) => entry.model_id === userAISettings.defaultModel
    );
  };

  const normalizeAIModelSelection = () => {
    const selectedModel = modelCatalog.models.find(
      (entry) =>
        entry.provider_id === aiSettings.defaultProviderId &&
        entry.model_id === aiSettings.defaultModel
    );
    if (selectedModel) return;
    const byModelId = modelCatalog.models.find((entry) => entry.model_id === aiSettings.defaultModel);
    if (byModelId) {
      aiSettings.defaultProviderId = byModelId.provider_id;
      return;
    }
    const firstModel = modelCatalog.models[0];
    if (firstModel) {
      aiSettings.defaultProviderId = firstModel.provider_id;
      aiSettings.defaultModel = firstModel.model_id;
    }
  };

  const normalizeUserAIModelSelection = () => {
    const selectedModel = modelCatalog.models.find(
      (entry) =>
        entry.provider_id === userAISettings.defaultProviderId &&
        entry.model_id === userAISettings.defaultModel
    );
    if (selectedModel) return;
    const byModelId = modelCatalog.models.find(
      (entry) => entry.model_id === userAISettings.defaultModel
    );
    if (byModelId) {
      userAISettings.defaultProviderId = byModelId.provider_id;
      return;
    }
    const firstModel = modelCatalog.models[0];
    if (firstModel) {
      userAISettings.defaultProviderId = firstModel.provider_id;
      userAISettings.defaultModel = firstModel.model_id;
    }
  };

  const saveAISettings = async () => {
    isSavingAISettings = true;
    try {
      normalizeAIModelSelection();
      const result = await apiPut('/ai-settings', aiSettings);
      aiSettings = result.settings;
      addToast({
        type: 'success',
        message: get(_)('settings.ai.toast.updated')
      });
    } catch (error) {
      console.error('Failed to save AI settings:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.ai.errors.save')
      });
    } finally {
      isSavingAISettings = false;
    }
  };

  const saveUserAISettings = async () => {
    isSavingUserAISettings = true;
    try {
      normalizeUserAIModelSelection();
      const result = await apiPut('/me/ai-settings', {
        defaultProviderId: userAISettings.defaultProviderId,
        defaultModel: userAISettings.defaultModel,
      });
      userAISettings.defaultProviderId = result.settings.defaultProviderId;
      userAISettings.defaultModel = result.settings.defaultModel;
      emitUserAISettingsUpdated({
        defaultProviderId: userAISettings.defaultProviderId,
        defaultModel: userAISettings.defaultModel,
      });
      addToast({
        type: 'success',
        message: get(_)('settings.userAi.toast.updated')
      });
    } catch (error) {
      console.error('Failed to save user AI settings:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.userAi.errors.save')
      });
    } finally {
      isSavingUserAISettings = false;
    }
  };

  // Fonctions pour la gestion de la queue
  const loadQueueStats = async () => {
    try {
      queueStats = await apiGet('/queue/stats');
    } catch (error) {
      console.error('Failed to load queue stats:', error);
    }
  };

	          const purgeQueue = async (status = 'pending') => {
	            let confirmMessage = '';
	            if (status === 'pending') {
	              confirmMessage = get(_)('settings.queue.confirmPurgePending');
	            } else if (status === 'processing') {
	              confirmMessage = get(_)('settings.queue.confirmPurgeProcessing');
	            } else {
	              confirmMessage = get(_)('settings.queue.confirmPurgeAll');
	            }

            if (!confirm(confirmMessage)) {
              return;
            }

            isPurgingQueue = true;
            try {
              const result = await apiPost('/queue/purge', { status });
              addToast({
                type: 'success',
                message: result.message
              });
              
              await loadQueueStats();
	            } catch (error) {
	              console.error('Failed to purge queue:', error);
	              addToast({
	                type: 'error',
	                message: get(_)('settings.queue.errors.purge')
	              });
	            } finally {
	              isPurgingQueue = false;
	            }
	          };

	          const purgeAllQueue = async () => {
	            if (!confirm(get(_)('settings.queue.confirmPurgeAll'))) {
	              return;
	            }

            isPurgingQueue = true;
            try {
              const result = await apiPost('/queue/purge', { status: 'all' });
              addToast({
                type: 'success',
                message: result.message
              });
              
              await loadQueueStats();
	            } catch (error) {
	              console.error('Failed to purge queue:', error);
	              addToast({
	                type: 'error',
	                message: get(_)('settings.queue.errors.purge')
	              });
	            } finally {
	              isPurgingQueue = false;
	            }
	          };

	  const resetAllData = async () => {
	    if (!confirm(get(_)('settings.admin.confirmResetAll'))) {
	      return;
	    }

    isResetting = true;
    try {
      await apiPost('/admin/reset');

	      addToast({
	        type: 'success',
	        message: get(_)('settings.admin.toast.resetDone')
	      });

	      // Redirect to home
	      goto('/');
	    } catch (error) {
	      console.error('Failed to reset data:', error);
	      addToast({
	        type: 'error',
	        message: get(_)('settings.admin.errors.reset')
	      });
	    } finally {
	      isResetting = false;
	    }
	  };
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">{$_('settings.title')}</h1>

  <!-- Section Compte & Workspace (tous les utilisateurs) -->
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800">{$_('settings.accountWorkspace')}</h2>

    {#if $me.loading}
      <p class="text-sm text-slate-600">{$_('common.loading')}</p>
    {:else if $me.error}
      <p class="text-sm text-rose-700">{$me.error}</p>
    {:else if $me.data}
      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded border border-slate-200 p-4">
          <h3 class="font-medium">{$_('settings.account')}</h3>
          <div class="mt-2 text-sm text-slate-700 space-y-1">
            <div><span class="text-slate-500">{$_('settings.emailLabel')}:</span> {$me.data.user?.email ?? '—'}</div>
            <div><span class="text-slate-500">{$_('settings.nameLabel')}:</span> {$me.data.user?.displayName ?? '—'}</div>
            <div><span class="text-slate-500">{$_('settings.effectiveRoleLabel')}:</span> {$me.data.effectiveRole}</div>
            <div><span class="text-slate-500">{$_('settings.statusLabel')}:</span> {$me.data.user?.accountStatus}</div>
          </div>
	          {#if $me.data.user?.accountStatus === 'pending_admin_approval'}
	            <p class="mt-2 text-sm text-amber-700">
	              {$_('settings.accountStatus.pendingAdminApproval')}
	            </p>
	          {:else if $me.data.user?.accountStatus === 'approval_expired_readonly'}
	            <p class="mt-2 text-sm text-amber-700">
	              {$_('settings.accountStatus.approvalExpiredReadonly')}
	            </p>
	          {/if}
        </div>

        <div class="rounded border border-slate-200 p-4">
          <h3 class="font-medium">{$_('settings.workspace')}</h3>
          <div class="mt-3 space-y-3">
            <WorkspaceSettingsPanel />
          </div>
        </div>
      </div>

      <div class="rounded border border-rose-200 bg-rose-50 p-4">
	        <h3 class="font-medium text-rose-800">{$_('settings.dangerZone')}</h3>
	        <div class="mt-3 flex flex-wrap gap-2">
	          <button class="rounded bg-amber-700 px-3 py-2 text-sm text-white" on:click={handleDeactivate} disabled={deactivating}>
	            {$_('settings.deactivateAccount')}
	          </button>
	          <button class="rounded bg-rose-700 px-3 py-2 text-sm text-white" on:click={handleDelete} disabled={deleting}>
	            {$_('settings.deleteAccount')}
	          </button>
	        </div>
	      </div>
    {/if}
  </div>

  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800">{$_('settings.userAi.title')}</h2>
    <p class="text-sm text-slate-600">{$_('settings.userAi.description')}</p>

    {#if isLoadingModelCatalog || isLoadingUserAISettings}
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        <p class="text-sm text-blue-700">{$_('settings.aiLoading')}</p>
      </div>
    {:else}
      <div class="space-y-4">
        <div>
          <label for="user-ai-default-model" class="block text-sm font-medium text-slate-700 mb-2">
            {$_('settings.aiDefaultModel')}
          </label>
          <select
            id="user-ai-default-model"
            value={selectedUserDefaultModelSelectionKey()}
            on:change={handleUserDefaultModelSelectionChange}
            class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {#if modelCatalogGroups.length === 0}
              {#if fallbackUserDefaultModelOption()}
                <option
                  value={modelSelectionKey(fallbackUserDefaultModelOption()?.provider_id ?? userAISettings.defaultProviderId, userAISettings.defaultModel)}
                >
                  {fallbackUserDefaultModelOption()?.label ?? userAISettings.defaultModel}
                </option>
              {:else}
                <option value={selectedUserDefaultModelSelectionKey()}>
                  {userAISettings.defaultModel}
                </option>
              {/if}
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
          <p class="text-xs text-slate-500 mt-1">{$_('settings.aiDefaultModelHint')}</p>
        </div>

        <button
          on:click={saveUserAISettings}
          disabled={isSavingUserAISettings}
          class="w-full px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSavingUserAISettings ? $_('settings.userAi.saving') : $_('settings.userAi.save')}
        </button>
      </div>
    {/if}
  </div>

  <div class="space-y-4 rounded border border-slate-200 bg-white p-6" data-testid="chrome-extension-download-card">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-slate-800">{$_('settings.chromeExtension.title')}</h2>
        <p class="text-sm text-slate-600">{$_('settings.chromeExtension.description')}</p>
        <p class="text-sm font-medium text-rose-700">
          {$_('settings.chromeExtension.experimentalWarning')}
        </p>
      </div>

      {#if isLoadingChromeExtensionDownload}
        <span class="text-sm text-slate-600" data-testid="chrome-extension-download-loading">
          {$_('settings.chromeExtension.loading')}
        </span>
      {:else if chromeExtensionDownloadMetadata}
        <a
          class="inline-flex items-center justify-center rounded p-2 transition text-primary hover:bg-slate-100"
          href={chromeExtensionDownloadMetadata.downloadUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={$_('settings.chromeExtension.downloadTooltip')}
          title={$_('settings.chromeExtension.downloadTooltip')}
          data-testid="chrome-extension-download-cta"
        >
          <Download class="h-5 w-5" />
        </a>
      {:else}
        <button
          class="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          type="button"
          on:click={loadChromeExtensionDownloadMetadata}
          data-testid="chrome-extension-download-retry"
        >
          {$_('settings.chromeExtension.retry')}
        </button>
      {/if}
    </div>

    {#if chromeExtensionDownloadMetadata}
      <dl class="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
        <div class="rounded border border-slate-200 p-3">
          <dt class="text-slate-500">{$_('settings.chromeExtension.versionLabel')}</dt>
          <dd class="font-medium text-slate-900" data-testid="chrome-extension-version">
            {chromeExtensionDownloadMetadata.version}
          </dd>
        </div>
        <div class="rounded border border-slate-200 p-3">
          <dt class="text-slate-500">{$_('settings.chromeExtension.sourceLabel')}</dt>
          <dd class="font-medium text-slate-900" data-testid="chrome-extension-source">
            {chromeExtensionDownloadMetadata.source}
          </dd>
        </div>
      </dl>
    {:else if chromeExtensionDownloadError}
      <p class="text-sm text-rose-700" data-testid="chrome-extension-download-error">
        {chromeExtensionDownloadError}
      </p>
    {/if}
  </div>

  {#if !isAdmin()}
    <div class="rounded border border-slate-200 bg-white p-6">
      <p class="text-sm text-slate-600">{$_('settings.adminOnlyHint')}</p>
    </div>
  {:else}
  
  <!-- Section Gestion des Prompts -->
	  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
	    <h2 class="text-lg font-semibold text-slate-800 mb-4">{$_('settings.promptManagement')}</h2>
	    <p class="text-sm text-slate-600 mb-4">
	      {$_('settings.prompts.description')}
	    </p>
    
    <div class="grid gap-4">
      {#each prompts as prompt}
        <div 
          role="button"
          tabindex="0"
          class="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 cursor-pointer" 
          on:click={() => openPromptEditor(prompt)}
          on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPromptEditor(prompt);
            }
          }}>
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <h3 class="font-medium text-slate-900">{prompt.name}</h3>
              <p class="text-sm text-slate-600 mt-1">{prompt.description}</p>
              <div class="flex gap-2 mt-2">
                {#each prompt.variables as variable}
                  <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {variable}
                  </span>
                {/each}
              </div>
            </div>
            <Edit class="w-5 h-5 text-slate-400" />
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Section Configuration IA -->
	  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
	    <h2 class="text-lg font-semibold text-slate-800 mb-4">{$_('settings.aiConfig')}</h2>
	    <p class="text-sm text-slate-600 mb-4">
	      {$_('settings.ai.description')}
	    </p>
    
    {#if isLoadingAISettings || isLoadingModelCatalog}
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        <p class="text-sm text-blue-700">{$_('settings.aiLoading')}</p>
      </div>
    {:else}
      <div class="grid gap-6 md:grid-cols-2">
        <div>
          <label for="ai-default-model" class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.aiDefaultModel')}</label>
          <select
            id="ai-default-model"
            value={selectedDefaultModelSelectionKey()}
            on:change={handleDefaultModelSelectionChange}
            class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {#if modelCatalogGroups.length === 0}
              {#if fallbackDefaultModelOption()}
                <option
                  value={modelSelectionKey(fallbackDefaultModelOption()?.provider_id ?? aiSettings.defaultProviderId, aiSettings.defaultModel)}
                >
                  {fallbackDefaultModelOption()?.label ?? aiSettings.defaultModel}
                </option>
              {:else}
                <option value={selectedDefaultModelSelectionKey()}>
                  {aiSettings.defaultModel}
                </option>
              {/if}
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
          <p class="text-xs text-slate-500 mt-1">{$_('settings.aiDefaultModelHint')}</p>
        </div>

        <!-- Concurrence -->
        <div>
          <label for="ai-concurrency" class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.aiConcurrency')}</label>
          <input 
            id="ai-concurrency"
            type="number" 
            bind:value={aiSettings.concurrency}
            min="1" 
            max="50"
            class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-slate-500 mt-1">{$_('settings.aiConcurrencyHint')}</p>
        </div>

        <!-- Concurrence publishing -->
        <div>
          <label for="publishing-concurrency" class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.publishingConcurrency')}</label>
          <input
            id="publishing-concurrency"
            type="number"
            bind:value={aiSettings.publishingConcurrency}
            min="1"
            max="50"
            class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-slate-500 mt-1">{$_('settings.publishingConcurrencyHint')}</p>
        </div>

        <!-- Intervalle de traitement -->
        <div>
          <label for="ai-processing-interval" class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.aiInterval')}</label>
          <input 
            id="ai-processing-interval"
            type="number" 
            bind:value={aiSettings.processingInterval}
            min="1000" 
            max="60000"
            step="1000"
            class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-slate-500 mt-1">{$_('settings.aiIntervalHint')}</p>
        </div>

        <!-- Bouton de sauvegarde -->
        <div class="flex items-end">
	          <button 
	            on:click={saveAISettings}
	            disabled={isSavingAISettings}
	            class="w-full px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
	          >
	            {isSavingAISettings ? $_('settings.ai.saving') : $_('settings.ai.save')}
	          </button>
	        </div>
      </div>
    {/if}
  </div>

  <!-- Section Gestion de la Queue -->
	  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
	    <h2 class="text-lg font-semibold text-slate-800 mb-4">{$_('settings.queueManagement')}</h2>
	    <p class="text-sm text-slate-600 mb-4">
	      {$_('settings.queue.description')}
	    </p>
    
    <!-- Statistiques de la queue -->
    <div class="grid gap-4 md:grid-cols-5">
      <div class="bg-slate-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-slate-900">{queueStats.total}</div>
        <div class="text-sm text-slate-600">{$_('settings.queueTotal')}</div>
      </div>
      <div class="bg-orange-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-orange-600">{queueStats.pending}</div>
        <div class="text-sm text-orange-600">{$_('settings.queuePending')}</div>
      </div>
      <div class="bg-blue-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-blue-600">{queueStats.processing}</div>
        <div class="text-sm text-blue-600">{$_('settings.queueRunning')}</div>
      </div>
      <div class="bg-green-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-green-600">{queueStats.completed}</div>
        <div class="text-sm text-green-600">{$_('settings.queueDone')}</div>
      </div>
      <div class="bg-red-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-red-600">{queueStats.failed}</div>
        <div class="text-sm text-red-600">{$_('settings.queueFailed')}</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex gap-2 flex-wrap">
	      <button 
	        on:click={loadQueueStats}
	        class="px-4 py-2 bg-slate-600 text-white rounded hover:bg-slate-700 transition-colors"
	      >
	        {$_('settings.queue.refresh')}
	      </button>
	      <button 
	        on:click={() => purgeQueue('pending')}
	        disabled={isPurgingQueue || queueStats.pending === 0}
	        class="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
	      >
	        {isPurgingQueue ? $_('settings.queue.purging') : $_('settings.queue.purgePending', { values: { count: queueStats.pending } })}
	      </button>
	      <button 
	        on:click={() => purgeQueue('processing')}
	        disabled={isPurgingQueue || queueStats.processing === 0}
	        class="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
	      >
	        {isPurgingQueue ? $_('settings.queue.purging') : $_('settings.queue.purgeProcessing', { values: { count: queueStats.processing } })}
	      </button>
	      <button 
	        on:click={purgeAllQueue}
	        disabled={isPurgingQueue || queueStats.total === 0}
	        class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
	      >
	        {isPurgingQueue ? $_('settings.queue.purging') : $_('settings.queue.purgeAll', { values: { count: queueStats.total } })}
	      </button>
    </div>
  </div>

  {#if isAdminApp()}
    <!-- Interface admin (utilisateurs) - intégrée dans Paramètres -->
    <AdminUsersPanel embeddedTitle={$_('adminUsers.embeddedTitle.approvals')} />
  {/if}

  <!-- Section Administration -->
  <div class="rounded border border-red-200 bg-red-50 p-6">
    <h2 class="text-lg font-semibold text-red-800 mb-4">{$_('settings.dangerZone')}</h2>
	    <p class="text-red-700 mb-4">
	      {$_('settings.admin.resetDescription')}
	    </p>
    
    <button 
      class="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
      on:click={resetAllData}
      disabled={isResetting}
	    >
	      {isResetting ? $_('settings.admin.resetting') : $_('settings.admin.reset')}
	    </button>
  </div>

  <!-- Section Informations système -->
  <div class="rounded border border-blue-200 bg-blue-50 p-6">
    <h2 class="text-lg font-semibold text-blue-800 mb-4">{$_('settings.systemInfo')}</h2>
    <div class="space-y-2 text-sm text-blue-700">
      <p><strong>{$_('settings.systemInfoLabels.version')}:</strong> 1.0.0</p>
      <p><strong>{$_('settings.systemInfoLabels.database')}:</strong> SQLite</p>
      <p><strong>{$_('settings.systemInfoLabels.api')}:</strong> Hono + Drizzle ORM</p>
      <p><strong>{$_('settings.systemInfoLabels.frontend')}:</strong> SvelteKit + Tailwind CSS</p>
    </div>
  </div>

  {/if}
</section>

<!-- Modal d'édition des prompts -->
{#if showPromptEditor}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto w-full mx-4">
      <div class="p-6">
	        <div class="flex justify-between items-center mb-6">
	          <h3 class="text-lg font-semibold">{$_('settings.editPrompt')}</h3>
	          <button 
	            on:click={closePromptEditor}
	            aria-label={$_('settings.prompts.closeEditor')}
	            class="text-gray-400 hover:text-gray-600"
	          >
            <X class="w-6 h-6" />
          </button>
        </div>

        <div class="space-y-4">
          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.promptName')}</span>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptName}
            </div>
          </div>

          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.promptDescription')}</span>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptDescription}
            </div>
          </div>

          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.detectedVariables')}</span>
            <div class="flex flex-wrap gap-2">
              {#each promptVariables as variable}
                <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {variable}
                </span>
              {/each}
              {#if promptVariables.length === 0}
                <span class="text-sm text-slate-500 italic">{$_('settings.noVariablesDetected')}</span>
              {/if}
            </div>
          </div>

          <div>
            <label for="prompt-content" class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.promptContent')}</label>
	            <textarea 
	              id="prompt-content"
	              bind:value={promptContent}
	              class="w-full h-96 px-3 py-2 border border-slate-300 rounded-md font-mono text-sm"
	              placeholder={$_('settings.prompts.editorPlaceholder')}
	            ></textarea>
	          </div>
	        </div>

        <div class="flex justify-end gap-3 mt-6">
	          <button 
	            on:click={closePromptEditor}
	            class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
	          >
	            {$_('common.cancel')}
	          </button>
	          <button 
	            on:click={savePrompt}
	            class="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
	          >
	            {$_('common.save')}
	          </button>
	        </div>
      </div>
    </div>
  </div>
{/if}
