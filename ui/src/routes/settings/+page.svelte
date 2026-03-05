<script lang="ts">
  import { addToast } from '$lib/stores/toast';
  import { apiDelete, apiGet, apiPost, apiPut } from '$lib/utils/api';
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
  import {
    fetchVsCodeExtensionDownloadMetadata,
    getVsCodeExtensionDownloadErrorMessage,
    type VsCodeExtensionDownloadMetadata,
  } from '$lib/utils/vscode-extension-download';
  import {
    completeCodexProviderEnrollment,
    disconnectCodexProviderEnrollment,
    fetchProviderConnections,
    startCodexProviderEnrollment,
    type ProviderConnectionState,
  } from '$lib/utils/provider-connections-api';
  import { emitUserAISettingsUpdated } from '$lib/utils/user-ai-settings-events';
  import {
    themePreference,
    type ThemePreference,
  } from '$lib/stores/themePreference';
  import AdminUsersPanel from '$lib/components/AdminUsersPanel.svelte';
  import WorkspaceSettingsPanel from '$lib/components/WorkspaceSettingsPanel.svelte';
  import TodoRuntimeConfigPanel from '$lib/components/TodoRuntimeConfigPanel.svelte';
  import { Copy, Download, RefreshCw } from '@lucide/svelte';

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

  interface VsCodeExtensionTokenMeta {
    issuedByUserId: string;
    issuedAt: string;
    expiresAt: string;
    last4: string;
    revokedAt: string | null;
  }

  interface VsCodeExtensionTokenStatusPayload {
    active: boolean;
    meta: VsCodeExtensionTokenMeta | null;
  }

  interface VsCodeExtensionTokenIssuePayload extends VsCodeExtensionTokenStatusPayload {
    token: string;
  }

  let isResetting = false;
  let chromeExtensionDownloadMetadata: ChromeExtensionDownloadMetadata | null = null;
  let chromeExtensionDownloadError = '';
  let isLoadingChromeExtensionDownload = false;
  let vscodeExtensionDownloadMetadata: VsCodeExtensionDownloadMetadata | null = null;
  let vscodeExtensionDownloadError = '';
  let isLoadingVsCodeExtensionDownload = false;
  let isLoadingVsCodeExtensionToken = false;
  let isIssuingVsCodeExtensionToken = false;
  let isRevokingVsCodeExtensionToken = false;
  let isCopyingVsCodeExtensionToken = false;
  let vscodeExtensionTokenActive = false;
  let vscodeExtensionTokenMeta: VsCodeExtensionTokenMeta | null = null;
  let vscodeExtensionTokenPlaintext = '';
  let vscodeExtensionTokenError = '';
  let isLoadingProviderConnections = false;
  let isSavingCodexProviderConnection = false;
  let providerConnectionsError = '';
  let providerConnections: ProviderConnectionState[] = [];
  let codexConnectionAccountLabel = '';
  
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
    await loadVsCodeExtensionDownloadMetadata();
    await loadModelCatalog();
    await loadUserAISettings();
    if (isAdmin()) {
      await loadAISettings();
      await loadQueueStats();
      await loadVsCodeExtensionTokenStatus();
      await loadProviderConnections();
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

  const updateThemePreference = (value: string) => {
    const next: ThemePreference =
      value === 'light' || value === 'dark' ? value : 'system';
    themePreference.set(next);
  };

  const formatDateTime = (iso: string | null | undefined): string => {
    if (!iso) return get(_)('settings.vscodeExtension.token.notAvailable');
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString();
  };

  const codexProviderConnection = () =>
    providerConnections.find((provider) => provider.providerId === 'codex') ||
    null;


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

  const loadVsCodeExtensionDownloadMetadata = async () => {
    isLoadingVsCodeExtensionDownload = true;
    vscodeExtensionDownloadError = '';

    try {
      vscodeExtensionDownloadMetadata = await fetchVsCodeExtensionDownloadMetadata();
    } catch (error) {
      console.error('Failed to load vscode extension metadata:', error);
      vscodeExtensionDownloadMetadata = null;
      vscodeExtensionDownloadError = getVsCodeExtensionDownloadErrorMessage(
        error,
        get(_)('settings.vscodeExtension.errors.load')
      );
    } finally {
      isLoadingVsCodeExtensionDownload = false;
    }
  };

  const loadVsCodeExtensionTokenStatus = async () => {
    isLoadingVsCodeExtensionToken = true;
    vscodeExtensionTokenError = '';
    try {
      const payload = await apiGet<VsCodeExtensionTokenStatusPayload>(
        '/settings/vscode-extension-token',
      );
      vscodeExtensionTokenActive = payload.active;
      vscodeExtensionTokenMeta = payload.meta;
    } catch (error) {
      console.error('Failed to load vscode extension token status:', error);
      vscodeExtensionTokenError =
        error instanceof Error
          ? error.message
          : get(_)('settings.vscodeExtension.token.errors.load');
    } finally {
      isLoadingVsCodeExtensionToken = false;
    }
  };

  const issueVsCodeExtensionToken = async () => {
    isIssuingVsCodeExtensionToken = true;
    vscodeExtensionTokenError = '';
    try {
      const payload = await apiPost<VsCodeExtensionTokenIssuePayload>(
        '/settings/vscode-extension-token',
      );
      vscodeExtensionTokenActive = payload.active;
      vscodeExtensionTokenMeta = payload.meta;
      vscodeExtensionTokenPlaintext = payload.token;
      addToast({
        type: 'success',
        message: get(_)('settings.vscodeExtension.token.toasts.issued'),
      });
    } catch (error) {
      console.error('Failed to issue vscode extension token:', error);
      vscodeExtensionTokenError =
        error instanceof Error
          ? error.message
          : get(_)('settings.vscodeExtension.token.errors.issue');
    } finally {
      isIssuingVsCodeExtensionToken = false;
    }
  };

  const revokeVsCodeExtensionToken = async () => {
    isRevokingVsCodeExtensionToken = true;
    vscodeExtensionTokenError = '';
    try {
      const payload = await apiDelete<VsCodeExtensionTokenStatusPayload & { revoked: boolean }>(
        '/settings/vscode-extension-token',
      );
      vscodeExtensionTokenActive = payload.active;
      vscodeExtensionTokenMeta = payload.meta;
      vscodeExtensionTokenPlaintext = '';
      addToast({
        type: 'success',
        message: get(_)('settings.vscodeExtension.token.toasts.revoked'),
      });
    } catch (error) {
      console.error('Failed to revoke vscode extension token:', error);
      vscodeExtensionTokenError =
        error instanceof Error
          ? error.message
          : get(_)('settings.vscodeExtension.token.errors.revoke');
    } finally {
      isRevokingVsCodeExtensionToken = false;
    }
  };

  const copyVsCodeExtensionToken = async () => {
    if (!vscodeExtensionTokenPlaintext) return;
    isCopyingVsCodeExtensionToken = true;
    try {
      await navigator.clipboard.writeText(vscodeExtensionTokenPlaintext);
      addToast({
        type: 'success',
        message: get(_)('settings.vscodeExtension.token.toasts.copied'),
      });
    } catch (error) {
      console.error('Failed to copy vscode extension token:', error);
      addToast({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : get(_)('settings.vscodeExtension.token.errors.copy'),
      });
    } finally {
      isCopyingVsCodeExtensionToken = false;
    }
  };

  const loadProviderConnections = async () => {
    isLoadingProviderConnections = true;
    providerConnectionsError = '';
    try {
      providerConnections = await fetchProviderConnections();
      codexConnectionAccountLabel =
        providerConnections.find((provider) => provider.providerId === 'codex')
          ?.accountLabel || '';
    } catch (error) {
      console.error('Failed to load provider connections:', error);
      providerConnectionsError =
        error instanceof Error
          ? error.message
          : get(_)('settings.providerConnections.errors.load');
    } finally {
      isLoadingProviderConnections = false;
    }
  };

  const syncCodexProviderInList = (updatedProvider: ProviderConnectionState) => {
    providerConnections = providerConnections.map((provider) =>
      provider.providerId === 'codex' ? updatedProvider : provider,
    );
    if (!providerConnections.some((provider) => provider.providerId === 'codex')) {
      providerConnections = [updatedProvider, ...providerConnections];
    }
    codexConnectionAccountLabel = updatedProvider.accountLabel || '';
  };

  const startCodexProviderConnection = async () => {
    isSavingCodexProviderConnection = true;
    providerConnectionsError = '';
    try {
      const updatedProvider = await startCodexProviderEnrollment({
        accountLabel: codexConnectionAccountLabel.trim() || null,
      });
      syncCodexProviderInList(updatedProvider);
      const enrollmentUrl = updatedProvider.enrollmentUrl;
      if (enrollmentUrl) {
        window.open(enrollmentUrl, '_blank', 'noopener,noreferrer');
      }
      addToast({
        type: 'success',
        message: get(_)('settings.providerConnections.toasts.codexEnrollmentStarted'),
      });
    } catch (error) {
      console.error('Failed to update codex provider connection:', error);
      providerConnectionsError =
        error instanceof Error
          ? error.message
          : get(_)('settings.providerConnections.errors.save');
    } finally {
      isSavingCodexProviderConnection = false;
    }
  };

  const completeCodexProviderConnection = async () => {
    const codex = codexProviderConnection();
    if (!codex?.enrollmentId) {
      providerConnectionsError = get(_)('settings.providerConnections.errors.missingEnrollment');
      return;
    }
    isSavingCodexProviderConnection = true;
    providerConnectionsError = '';
    try {
      const updatedProvider = await completeCodexProviderEnrollment({
        enrollmentId: codex.enrollmentId,
        accountLabel: codexConnectionAccountLabel.trim() || null,
      });
      syncCodexProviderInList(updatedProvider);
      addToast({
        type: 'success',
        message: get(_)('settings.providerConnections.toasts.codexConnected'),
      });
    } catch (error) {
      console.error('Failed to complete codex provider enrollment:', error);
      providerConnectionsError =
        error instanceof Error
          ? error.message
          : get(_)('settings.providerConnections.errors.save');
    } finally {
      isSavingCodexProviderConnection = false;
    }
  };

  const disconnectCodexProviderConnection = async () => {
    isSavingCodexProviderConnection = true;
    providerConnectionsError = '';
    try {
      const updatedProvider = await disconnectCodexProviderEnrollment();
      syncCodexProviderInList(updatedProvider);
      addToast({
        type: 'success',
        message: get(_)('settings.providerConnections.toasts.codexDisconnected'),
      });
    } catch (error) {
      console.error('Failed to disconnect codex provider connection:', error);
      providerConnectionsError =
        error instanceof Error
          ? error.message
          : get(_)('settings.providerConnections.errors.save');
    } finally {
      isSavingCodexProviderConnection = false;
    }
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
    <h2 class="text-lg font-semibold text-slate-800">{$_('settings.theme.title')}</h2>
    <p class="text-sm text-slate-600">{$_('settings.theme.description')}</p>
    <div class="max-w-sm space-y-2">
      <label for="theme-preference" class="block text-sm font-medium text-slate-700">
        {$_('settings.theme.modeLabel')}
      </label>
      <select
        id="theme-preference"
        value={$themePreference}
        on:change={(event) =>
          updateThemePreference((event.currentTarget as HTMLSelectElement).value)}
        class="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="system">{$_('settings.theme.modes.system')}</option>
        <option value="light">{$_('settings.theme.modes.light')}</option>
        <option value="dark">{$_('settings.theme.modes.dark')}</option>
      </select>
    </div>
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

  <TodoRuntimeConfigPanel />

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

  <div class="space-y-4 rounded border border-slate-200 bg-white p-6" data-testid="vscode-extension-download-card">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-slate-800">{$_('settings.vscodeExtension.title')}</h2>
        <p class="text-sm text-slate-600">{$_('settings.vscodeExtension.description')}</p>
        <p class="text-sm font-medium text-rose-700">
          {$_('settings.vscodeExtension.experimentalWarning')}
        </p>
      </div>

      {#if isLoadingVsCodeExtensionDownload}
        <span class="text-sm text-slate-600" data-testid="vscode-extension-download-loading">
          {$_('settings.vscodeExtension.loading')}
        </span>
      {:else if vscodeExtensionDownloadMetadata}
        <a
          class="inline-flex items-center justify-center rounded p-2 transition text-primary hover:bg-slate-100"
          href={vscodeExtensionDownloadMetadata.downloadUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={$_('settings.vscodeExtension.downloadTooltip')}
          title={$_('settings.vscodeExtension.downloadTooltip')}
          data-testid="vscode-extension-download-cta"
        >
          <Download class="h-5 w-5" />
        </a>
      {:else}
        <button
          class="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          type="button"
          on:click={loadVsCodeExtensionDownloadMetadata}
          data-testid="vscode-extension-download-retry"
        >
          {$_('settings.vscodeExtension.retry')}
        </button>
      {/if}
    </div>

    {#if vscodeExtensionDownloadMetadata}
      <dl class="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
        <div class="rounded border border-slate-200 p-3">
          <dt class="text-slate-500">{$_('settings.vscodeExtension.versionLabel')}</dt>
          <dd class="font-medium text-slate-900" data-testid="vscode-extension-version">
            {vscodeExtensionDownloadMetadata.version}
          </dd>
        </div>
        <div class="rounded border border-slate-200 p-3">
          <dt class="text-slate-500">{$_('settings.vscodeExtension.sourceLabel')}</dt>
          <dd class="font-medium text-slate-900" data-testid="vscode-extension-source">
            {vscodeExtensionDownloadMetadata.source}
          </dd>
        </div>
      </dl>
    {:else if vscodeExtensionDownloadError}
      <p class="text-sm text-rose-700" data-testid="vscode-extension-download-error">
        {vscodeExtensionDownloadError}
      </p>
    {/if}
    {#if isAdmin()}
      <div class="space-y-3 rounded border border-slate-200 bg-slate-50 p-4" data-testid="vscode-extension-token-card">
        <div class="space-y-1">
          <h3 class="text-sm font-semibold text-slate-800">{$_('settings.vscodeExtension.token.title')}</h3>
          <p class="text-xs text-slate-600">{$_('settings.vscodeExtension.token.description')}</p>
        </div>
        {#if isLoadingVsCodeExtensionToken}
          <p class="text-xs text-slate-600">{$_('settings.vscodeExtension.token.loading')}</p>
        {:else}
          <dl class="grid gap-2 text-xs text-slate-700 md:grid-cols-2">
            <div class="rounded border border-slate-200 bg-white p-2">
              <dt class="text-slate-500">{$_('settings.vscodeExtension.token.statusLabel')}</dt>
              <dd class="font-medium text-slate-900" data-testid="vscode-extension-token-status">
                {vscodeExtensionTokenActive
                  ? $_('settings.vscodeExtension.token.statusActive')
                  : $_('settings.vscodeExtension.token.statusInactive')}
              </dd>
            </div>
            <div class="rounded border border-slate-200 bg-white p-2">
              <dt class="text-slate-500">{$_('settings.vscodeExtension.token.last4Label')}</dt>
              <dd class="font-medium text-slate-900" data-testid="vscode-extension-token-last4">
                {vscodeExtensionTokenMeta?.last4 ?? $_('settings.vscodeExtension.token.notAvailable')}
              </dd>
            </div>
            <div class="rounded border border-slate-200 bg-white p-2">
              <dt class="text-slate-500">{$_('settings.vscodeExtension.token.issuedAtLabel')}</dt>
              <dd class="font-medium text-slate-900">
                {formatDateTime(vscodeExtensionTokenMeta?.issuedAt)}
              </dd>
            </div>
            <div class="rounded border border-slate-200 bg-white p-2">
              <dt class="text-slate-500">{$_('settings.vscodeExtension.token.expiresAtLabel')}</dt>
              <dd class="font-medium text-slate-900">
                {formatDateTime(vscodeExtensionTokenMeta?.expiresAt)}
              </dd>
            </div>
          </dl>

          <div class="flex flex-wrap items-center gap-2">
            <button
              class="inline-flex items-center gap-2 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              type="button"
              on:click={issueVsCodeExtensionToken}
              disabled={isIssuingVsCodeExtensionToken || isRevokingVsCodeExtensionToken}
            >
              <RefreshCw class="h-3.5 w-3.5" />
              {vscodeExtensionTokenActive
                ? $_('settings.vscodeExtension.token.rotate')
                : $_('settings.vscodeExtension.token.issue')}
            </button>
            <button
              class="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              type="button"
              on:click={revokeVsCodeExtensionToken}
              disabled={!vscodeExtensionTokenActive || isIssuingVsCodeExtensionToken || isRevokingVsCodeExtensionToken}
            >
              {$_('settings.vscodeExtension.token.revoke')}
            </button>
          </div>

          {#if vscodeExtensionTokenPlaintext}
            <div class="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
              <p class="text-xs text-amber-800">{$_('settings.vscodeExtension.token.oneTimeNotice')}</p>
              <div class="flex items-center gap-2">
                <input
                  class="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-700"
                  type="text"
                  readonly
                  value={vscodeExtensionTokenPlaintext}
                  data-testid="vscode-extension-token-plaintext"
                />
                <button
                  class="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-amber-100 disabled:opacity-50"
                  type="button"
                  on:click={copyVsCodeExtensionToken}
                  disabled={isCopyingVsCodeExtensionToken}
                  data-testid="vscode-extension-token-copy"
                >
                  <Copy class="h-3.5 w-3.5" />
                  {$_('settings.vscodeExtension.token.copy')}
                </button>
              </div>
            </div>
          {/if}

          {#if vscodeExtensionTokenError}
            <p class="text-sm text-rose-700" data-testid="vscode-extension-token-error">
              {vscodeExtensionTokenError}
            </p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  {#if !isAdmin()}
    <div class="rounded border border-slate-200 bg-white p-6">
      <p class="text-sm text-slate-600">{$_('settings.adminOnlyHint')}</p>
    </div>
  {:else}

  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800 mb-1">
      {$_('settings.providerConnections.title')}
    </h2>
    <p class="text-sm text-slate-600">
      {$_('settings.providerConnections.description')}
    </p>

    {#if isLoadingProviderConnections}
      <p class="text-sm text-slate-600">{$_('common.loading')}</p>
    {:else}
      <div class="grid gap-3 md:grid-cols-3">
        {#each providerConnections as provider (provider.providerId)}
          <div class="rounded border border-slate-200 bg-slate-50 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-semibold text-slate-800">{provider.label}</div>
              <span
                class={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  provider.ready
                    ? 'bg-green-100 text-green-700'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {provider.ready
                  ? $_('settings.providerConnections.status.ready')
                  : $_('settings.providerConnections.status.notReady')}
              </span>
            </div>
            <div class="mt-1 text-xs text-slate-600">
              {provider.managedBy === 'admin_settings'
                ? $_('settings.providerConnections.managedBy.admin')
                : provider.managedBy === 'environment'
                  ? $_('settings.providerConnections.managedBy.environment')
                  : $_('settings.providerConnections.managedBy.none')}
            </div>
            {#if provider.accountLabel}
              <div class="mt-1 text-xs text-slate-500">{provider.accountLabel}</div>
            {/if}
          </div>
        {/each}
      </div>

      {#if codexProviderConnection()?.canConfigure}
        <div class="space-y-2 rounded border border-slate-200 p-3">
          <label for="codex-provider-account" class="block text-sm font-medium text-slate-700">
            {$_('settings.providerConnections.codex.accountLabel')}
          </label>
          <input
            id="codex-provider-account"
            type="text"
            bind:value={codexConnectionAccountLabel}
            placeholder={$_('settings.providerConnections.codex.accountPlaceholder')}
            class="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
            disabled={isSavingCodexProviderConnection}
          />
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              on:click={startCodexProviderConnection}
              disabled={isSavingCodexProviderConnection}
            >
              {$_('settings.providerConnections.codex.startEnrollment')}
            </button>
            {#if codexProviderConnection()?.connectionStatus === 'pending'}
              <button
                type="button"
                class="rounded border border-emerald-300 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                on:click={completeCodexProviderConnection}
                disabled={isSavingCodexProviderConnection}
              >
                {$_('settings.providerConnections.codex.completeEnrollment')}
              </button>
            {/if}
            <button
              type="button"
              class="rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              on:click={disconnectCodexProviderConnection}
              disabled={isSavingCodexProviderConnection}
            >
              {$_('settings.providerConnections.codex.disconnect')}
            </button>
          </div>
          {#if codexProviderConnection()?.connectionStatus === 'pending'}
            <p class="text-xs text-amber-700">
              {$_('settings.providerConnections.codex.pendingHint')}
            </p>
          {/if}
        </div>
      {/if}
    {/if}

    {#if providerConnectionsError}
      <p class="text-sm text-rose-700">{providerConnectionsError}</p>
    {/if}
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
