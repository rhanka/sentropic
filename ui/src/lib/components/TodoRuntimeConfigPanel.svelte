<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost, apiPut, apiDelete } from '$lib/utils/api';
  import { selectedWorkspaceRole } from '$lib/stores/workspaceScope';
  import { Copy, Pencil, RotateCcw, Trash2, Lock, UserPen } from '@lucide/svelte';

  type SourceLevel = 'code' | 'admin' | 'user';

  type AgentConfigItem = {
    id: string;
    key: string;
    name: string;
    description: string | null;
    config: Record<string, unknown> | null;
    sourceLevel: SourceLevel;
    lineageRootId: string | null;
    parentId: string | null;
    isDetached: boolean;
    lastParentSyncAt: string | null;
    updatedAt: string;
  };

  type WorkflowTask = {
    id: string;
    taskKey: string;
    title: string;
    description: string | null;
    orderIndex: number;
    agentDefinitionId?: string | null;
    inputSchema: Record<string, unknown> | null;
    outputSchema: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    sectionKey: string | null;
  };

  type WorkflowConfigItem = {
    id: string;
    key: string;
    name: string;
    description: string | null;
    config: Record<string, unknown> | null;
    sourceLevel: SourceLevel;
    lineageRootId: string | null;
    parentId: string | null;
    isDetached: boolean;
    lastParentSyncAt: string | null;
    updatedAt: string;
    tasks: WorkflowTask[];
  };

  type AgentDraft = {
    name: string;
    description: string;
    configText: string;
  };

  type WorkflowDraft = {
    name: string;
    description: string;
    configText: string;
  };

  const WORKFLOW_PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

  let isLoading = false;
  let isRefreshing = false;
  let isSaving = false;
  let isCopying = false;
  let isResettingConfig = false;
  let isDeletingConfig = false;

  let agentConfigs: AgentConfigItem[] = [];
  let workflowConfigs: WorkflowConfigItem[] = [];

  let editingAgentId: string | null = null;
  let editingWorkflowId: string | null = null;
  let agentDraftById: Record<string, AgentDraft> = {};
  let workflowDraftById: Record<string, WorkflowDraft> = {};

  $: canEdit = $selectedWorkspaceRole === 'editor' || $selectedWorkspaceRole === 'admin';

  const parseDateMs = (value: string | null | undefined): number => {
    if (!value) return 0;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : 0;
  };

  const hasInheritanceDrift = (item: {
    parentId: string | null;
    isDetached: boolean;
    updatedAt: string;
    lastParentSyncAt: string | null;
  }): boolean => {
    if (!item.parentId || item.isDetached) return false;
    const updatedAtMs = parseDateMs(item.updatedAt);
    const syncedAtMs = parseDateMs(item.lastParentSyncAt);
    return syncedAtMs > 0 && updatedAtMs > syncedAtMs;
  };

  const formatAsJsonText = (value: unknown): string =>
    JSON.stringify(value ?? {}, null, 2);

  const parseObjectJson = (
    raw: string,
    errorI18nKey: string,
  ): Record<string, unknown> | null => {
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        addToast({
          type: 'error',
          message: get(_)(errorI18nKey),
        });
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      addToast({
        type: 'error',
        message: get(_)(errorI18nKey),
      });
      return null;
    }
  };

  const collectStrings = (value: unknown, target: string[]) => {
    if (typeof value === 'string') {
      target.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectStrings(item, target);
      return;
    }
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        collectStrings(nested, target);
      }
    }
  };

  const extractPlaceholdersFromText = (text: string): string[] => {
    const placeholders = new Set<string>();
    const matches = text.matchAll(WORKFLOW_PLACEHOLDER_PATTERN);
    for (const match of matches) {
      const token = match[1]?.trim();
      if (token) placeholders.add(token);
    }
    return [...placeholders];
  };

  const extractSectionPlaceholders = (
    sectionKey: string,
    value: unknown,
  ): { sectionKey: string; placeholders: string[] } => {
    const strings: string[] = [];
    collectStrings(value, strings);
    const placeholders = new Set<string>();
    for (const textValue of strings) {
      for (const token of extractPlaceholdersFromText(textValue)) {
        placeholders.add(token);
      }
    }
    return { sectionKey, placeholders: [...placeholders] };
  };

  const buildWorkflowPlaceholderMetadata = (
    item: WorkflowConfigItem,
    config: Record<string, unknown>,
    description: string,
  ) => {
    const sections: Array<{ sectionKey: string; placeholders: string[] }> = [];

    sections.push(extractSectionPlaceholders('workflow.description', description));
    sections.push(extractSectionPlaceholders('workflow.config', config));

    for (const task of item.tasks ?? []) {
      sections.push(
        extractSectionPlaceholders(`workflow.task.${task.taskKey}.title`, task.title),
      );
      sections.push(
        extractSectionPlaceholders(
          `workflow.task.${task.taskKey}.description`,
          task.description ?? '',
        ),
      );
      sections.push(
        extractSectionPlaceholders(
          `workflow.task.${task.taskKey}.inputSchema`,
          task.inputSchema ?? {},
        ),
      );
      sections.push(
        extractSectionPlaceholders(
          `workflow.task.${task.taskKey}.outputSchema`,
          task.outputSchema ?? {},
        ),
      );
      sections.push(
        extractSectionPlaceholders(
          `workflow.task.${task.taskKey}.metadata`,
          task.metadata ?? {},
        ),
      );
    }

    const filtered = sections.filter((section) => section.placeholders.length > 0);
    const tokens = [...new Set(filtered.flatMap((section) => section.placeholders))];

    return {
      extractedAt: new Date().toISOString(),
      sections: filtered,
      tokens,
    };
  };

  const loadConfigs = async (quiet = false) => {
    if (quiet) isRefreshing = true;
    else isLoading = true;
    try {
      const [agentPayload, workflowPayload] = await Promise.all([
        apiGet<{ items: AgentConfigItem[] }>('/agent-config'),
        apiGet<{ items: WorkflowConfigItem[] }>('/workflow-config'),
      ]);
      agentConfigs = Array.isArray(agentPayload.items) ? agentPayload.items : [];
      workflowConfigs = Array.isArray(workflowPayload.items)
        ? workflowPayload.items
        : [];
    } catch (error) {
      console.error('Failed to load TODO runtime config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.load'),
      });
    } finally {
      if (quiet) isRefreshing = false;
      else isLoading = false;
    }
  };

  const openAgentEditor = (item: AgentConfigItem) => {
    editingAgentId = item.id;
    agentDraftById[item.id] = {
      name: item.name,
      description: item.description ?? '',
      configText: formatAsJsonText(item.config ?? {}),
    };
  };

  const openWorkflowEditor = (item: WorkflowConfigItem) => {
    editingWorkflowId = item.id;
    workflowDraftById[item.id] = {
      name: item.name,
      description: item.description ?? '',
      configText: formatAsJsonText(item.config ?? {}),
    };
  };

  const isWorkflowConfigJsonEditable = (item: WorkflowConfigItem): boolean =>
    item.key !== 'ai_usecase_generation_v1';

  const saveAgent = async (item: AgentConfigItem) => {
    if (!canEdit) return;
    const draft = agentDraftById[item.id];
    if (!draft) return;

    const config = parseObjectJson(
      draft.configText,
      'settings.runtime.errors.invalidAgentConfigJson',
    );
    if (!config) return;

    const name = draft.name.trim();
    if (!name) {
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.missingName'),
      });
      return;
    }

    isSaving = true;
    try {
      const payload = {
        items: [
          {
            id: item.id,
            key: item.key,
            name,
            description: draft.description.trim() || null,
            config,
            sourceLevel: item.sourceLevel,
          },
        ],
      };
      const result = await apiPut<{ items: AgentConfigItem[] }>(
        '/agent-config',
        payload,
      );
      agentConfigs = Array.isArray(result.items) ? result.items : agentConfigs;
      editingAgentId = null;
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.agentSaved'),
      });
    } catch (error) {
      console.error('Failed to save agent config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.saveAgent'),
      });
    } finally {
      isSaving = false;
    }
  };

  const saveWorkflow = async (item: WorkflowConfigItem) => {
    if (!canEdit) return;
    const draft = workflowDraftById[item.id];
    if (!draft) return;

    const canEditConfigJson = isWorkflowConfigJsonEditable(item);
    const parsedConfig = canEditConfigJson
      ? parseObjectJson(
          draft.configText,
          'settings.runtime.errors.invalidWorkflowConfigJson',
        )
      : (item.config ?? {});
    if (!parsedConfig) return;

    const name = draft.name.trim();
    if (!name) {
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.missingName'),
      });
      return;
    }

    const configWithoutPlaceholderMetadata = {
      ...(parsedConfig as Record<string, unknown>),
    };
    delete (configWithoutPlaceholderMetadata as Record<string, unknown>)
      .placeholderMetadata;

    const placeholderMetadata = buildWorkflowPlaceholderMetadata(
      item,
      configWithoutPlaceholderMetadata,
      draft.description.trim(),
    );

    isSaving = true;
    try {
      const payload = {
        items: [
          {
            id: item.id,
            key: item.key,
            name,
            description: draft.description.trim() || null,
            config: {
              ...configWithoutPlaceholderMetadata,
              placeholderMetadata,
            },
            sourceLevel: item.sourceLevel,
            tasks: (item.tasks ?? []).map((task) => ({
              taskKey: task.taskKey,
              title: task.title,
              description: task.description,
              orderIndex: task.orderIndex,
              agentDefinitionId: task.agentDefinitionId ?? null,
              inputSchema: task.inputSchema ?? {},
              outputSchema: task.outputSchema ?? {},
              sectionKey: task.sectionKey ?? null,
              metadata: task.metadata ?? {},
            })),
          },
        ],
      };
      const result = await apiPut<{ items: WorkflowConfigItem[] }>(
        '/workflow-config',
        payload,
      );
      workflowConfigs = Array.isArray(result.items)
        ? result.items
        : workflowConfigs;
      editingWorkflowId = null;
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.workflowSaved'),
      });
    } catch (error) {
      console.error('Failed to save workflow config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.saveWorkflow'),
      });
    } finally {
      isSaving = false;
    }
  };

  // Helper: is system/admin config?
  const isSystemAgentConfig = (item: AgentConfigItem): boolean =>
    item.sourceLevel === 'code' || item.sourceLevel === 'admin';
  const isCopiedAgentConfig = (item: AgentConfigItem): boolean =>
    item.sourceLevel === 'user' && !!item.parentId;
  const isUserCreatedAgentConfig = (item: AgentConfigItem): boolean =>
    item.sourceLevel === 'user' && !item.parentId;
  const hasCopyForAgent = (parentId: string): boolean =>
    agentConfigs.some(a => a.parentId === parentId && a.sourceLevel === 'user');

  const isSystemWorkflowConfig = (item: WorkflowConfigItem): boolean =>
    item.sourceLevel === 'code' || item.sourceLevel === 'admin';
  const isCopiedWorkflowConfig = (item: WorkflowConfigItem): boolean =>
    item.sourceLevel === 'user' && !!item.parentId;
  const isUserCreatedWorkflowConfig = (item: WorkflowConfigItem): boolean =>
    item.sourceLevel === 'user' && !item.parentId;
  const hasCopyForWorkflow = (parentId: string): boolean =>
    workflowConfigs.some(w => w.parentId === parentId && w.sourceLevel === 'user');

  const copyAgent = async (item: AgentConfigItem) => {
    if (!canEdit) return;
    isCopying = true;
    try {
      const suffix = Date.now().toString().slice(-5);
      await apiPost(`/agent-config/${item.id}/copy`, {
        key: `${item.key}-copy-${suffix}`,
        name: `${item.name} (${get(_)('settings.runtime.customized')})`,
      });
      await loadConfigs(true);
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.copied'),
      });
    } catch (error) {
      console.error('Failed to copy agent config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.copy'),
      });
    } finally {
      isCopying = false;
    }
  };

  const resetAgent = async (item: AgentConfigItem) => {
    if (!canEdit || !item.parentId) return;
    if (!confirm(get(_)('settings.runtime.confirmReset'))) return;
    isResettingConfig = true;
    try {
      await apiPost(`/agent-config/${item.id}/reset`, {});
      await loadConfigs(true);
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.reset'),
      });
    } catch (error) {
      console.error('Failed to reset agent config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.reset'),
      });
    } finally {
      isResettingConfig = false;
    }
  };

  const deleteAgent = async (item: AgentConfigItem) => {
    if (!canEdit) return;
    if (!confirm(get(_)('settings.runtime.confirmDelete'))) return;
    isDeletingConfig = true;
    try {
      await apiDelete(`/agent-config/${item.id}`);
      await loadConfigs(true);
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.deleted'),
      });
    } catch (error) {
      console.error('Failed to delete agent config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.delete'),
      });
    } finally {
      isDeletingConfig = false;
    }
  };

  const copyWorkflow = async (item: WorkflowConfigItem) => {
    if (!canEdit) return;
    isCopying = true;
    try {
      const suffix = Date.now().toString().slice(-5);
      await apiPost(`/workflow-config/${item.id}/copy`, {
        key: `${item.key}-copy-${suffix}`,
        name: `${item.name} (${get(_)('settings.runtime.customized')})`,
      });
      await loadConfigs(true);
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.copied'),
      });
    } catch (error) {
      console.error('Failed to copy workflow config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.copy'),
      });
    } finally {
      isCopying = false;
    }
  };

  const resetWorkflow = async (item: WorkflowConfigItem) => {
    if (!canEdit || !item.parentId) return;
    if (!confirm(get(_)('settings.runtime.confirmReset'))) return;
    isResettingConfig = true;
    try {
      await apiPost(`/workflow-config/${item.id}/reset`, {});
      await loadConfigs(true);
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.reset'),
      });
    } catch (error) {
      console.error('Failed to reset workflow config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.reset'),
      });
    } finally {
      isResettingConfig = false;
    }
  };

  const deleteWorkflow = async (item: WorkflowConfigItem) => {
    if (!canEdit) return;
    if (!confirm(get(_)('settings.runtime.confirmDelete'))) return;
    isDeletingConfig = true;
    try {
      await apiDelete(`/workflow-config/${item.id}`);
      await loadConfigs(true);
      addToast({
        type: 'success',
        message: get(_)('settings.runtime.toasts.deleted'),
      });
    } catch (error) {
      console.error('Failed to delete workflow config:', error);
      addToast({
        type: 'error',
        message: get(_)('settings.runtime.errors.delete'),
      });
    } finally {
      isDeletingConfig = false;
    }
  };

  const getWorkflowPlaceholderTokens = (item: WorkflowConfigItem): string[] => {
    const metadata =
      item.config &&
      typeof item.config === 'object' &&
      !Array.isArray(item.config)
        ? (item.config.placeholderMetadata as
            | { tokens?: unknown }
            | undefined)
        : undefined;
    return Array.isArray(metadata?.tokens)
      ? metadata.tokens
          .map((token) => String(token ?? '').trim())
          .filter((token) => Boolean(token))
      : [];
  };

  onMount(() => {
    void loadConfigs();
  });
</script>

<div class="space-y-4 rounded border border-slate-200 bg-white p-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold text-slate-800">
        {$_('settings.runtime.title')}
      </h2>
      <p class="text-sm text-slate-600">{$_('settings.runtime.description')}</p>
    </div>
    <button
      type="button"
      class="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
      on:click={() => void loadConfigs(true)}
      disabled={isLoading || isRefreshing || isSaving}
    >
      {isRefreshing ? $_('settings.runtime.refreshing') : $_('settings.runtime.refresh')}
    </button>
  </div>

  {#if !canEdit}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      {$_('settings.runtime.readonlyHint')}
    </div>
  {/if}

  {#if isLoading}
    <p class="text-sm text-slate-600">{$_('settings.runtime.loading')}</p>
  {:else}
    <div class="space-y-6">
      <div class="space-y-3">
        <h3 class="text-base font-semibold text-slate-800">
          {$_('settings.runtime.agent.title')}
        </h3>
        <p class="text-sm text-slate-600">{$_('settings.runtime.agent.description')}</p>

        {#if agentConfigs.length === 0}
          <p class="text-sm text-slate-500">{$_('settings.runtime.empty')}</p>
        {:else}
          <div class="space-y-3">
            {#each agentConfigs as item (item.id)}
              <div class="rounded border border-slate-200 p-3" data-testid={`workflow-config-card-${item.key}`}>
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="space-y-1">
                    <div class="font-medium text-slate-900">{item.name}</div>
                    <div class="text-xs text-slate-500">{item.key}</div>
                    {#if item.description}
                      <div class="text-sm text-slate-700">{item.description}</div>
                    {/if}
                  </div>
                  <div class="flex flex-wrap gap-2">
                    {#if isSystemAgentConfig(item)}
                      <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-slate-100 text-slate-500">
                        <Lock class="w-3 h-3" />
                        {$_('settings.runtime.systemDefault')}
                      </span>
                    {:else if isCopiedAgentConfig(item)}
                      <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-blue-100 text-blue-700">
                        <UserPen class="w-3 h-3" />
                        ({$_('settings.runtime.customized')})
                      </span>
                    {/if}
                  </div>
                </div>

                {#if canEdit}
                  <div class="mt-3 flex flex-wrap gap-2">
                    {#if !isSystemAgentConfig(item)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        on:click={() => openAgentEditor(item)}
                      >
                        <Pencil class="w-3 h-3" />
                        {$_('settings.runtime.edit')}
                      </button>
                    {/if}
                    {#if isSystemAgentConfig(item) && !hasCopyForAgent(item.id)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-blue-300 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                        on:click={() => void copyAgent(item)}
                        disabled={isCopying || isSaving}
                      >
                        <Copy class="w-3 h-3" />
                        {$_('settings.runtime.copy')}
                      </button>
                    {/if}
                    {#if isCopiedAgentConfig(item)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        on:click={() => void resetAgent(item)}
                        disabled={isResettingConfig || isSaving}
                      >
                        <RotateCcw class="w-3 h-3" />
                        {$_('settings.runtime.resetToDefault')}
                      </button>
                    {/if}
                    {#if isUserCreatedAgentConfig(item)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        on:click={() => void deleteAgent(item)}
                        disabled={isDeletingConfig || isSaving}
                      >
                        <Trash2 class="w-3 h-3" />
                        {$_('common.delete')}
                      </button>
                    {/if}
                  </div>
                {/if}

                {#if editingAgentId === item.id}
                  <div class="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <label
                        class="mb-1 block text-xs font-medium text-slate-700"
                        for={`agent-name-${item.id}`}
                      >
                        {$_('settings.runtime.nameLabel')}
                      </label>
                      <input
                        id={`agent-name-${item.id}`}
                        class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        bind:value={agentDraftById[item.id].name}
                      />
                    </div>
                    <div>
                      <label
                        class="mb-1 block text-xs font-medium text-slate-700"
                        for={`agent-description-${item.id}`}
                      >
                        {$_('settings.runtime.descriptionLabel')}
                      </label>
                      <textarea
                        id={`agent-description-${item.id}`}
                        class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        rows={2}
                        bind:value={agentDraftById[item.id].description}
                      ></textarea>
                    </div>
                    <div>
                      <label
                        class="mb-1 block text-xs font-medium text-slate-700"
                        for={`agent-config-json-${item.id}`}
                      >
                        {$_('settings.runtime.configJsonLabel')}
                      </label>
                      <textarea
                        id={`agent-config-json-${item.id}`}
                        class="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
                        rows={8}
                        bind:value={agentDraftById[item.id].configText}
                      ></textarea>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                        on:click={() => void saveAgent(item)}
                        disabled={isSaving}
                      >
                        {$_('settings.runtime.save')}
                      </button>
                      <button
                        type="button"
                        class="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                        on:click={() => (editingAgentId = null)}
                      >
                        {$_('settings.runtime.cancel')}
                      </button>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="space-y-3">
        <h3 class="text-base font-semibold text-slate-800">
          {$_('settings.runtime.workflow.title')}
        </h3>
        <p class="text-sm text-slate-600">{$_('settings.runtime.workflow.description')}</p>

        {#if workflowConfigs.length === 0}
          <p class="text-sm text-slate-500">{$_('settings.runtime.empty')}</p>
        {:else}
          <div class="space-y-3">
            {#each workflowConfigs as item (item.id)}
              <div class="rounded border border-slate-200 p-3">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="space-y-1">
                    <div class="font-medium text-slate-900">{item.name}</div>
                    <div class="text-xs text-slate-500">{item.key}</div>
                    {#if item.description}
                      <div class="text-sm text-slate-700">{item.description}</div>
                    {/if}
                  </div>
                  <div class="flex flex-wrap gap-2">
                    {#if isSystemWorkflowConfig(item)}
                      <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-slate-100 text-slate-500">
                        <Lock class="w-3 h-3" />
                        {$_('settings.runtime.systemDefault')}
                      </span>
                    {:else if isCopiedWorkflowConfig(item)}
                      <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-blue-100 text-blue-700">
                        <UserPen class="w-3 h-3" />
                        ({$_('settings.runtime.customized')})
                      </span>
                    {/if}
                  </div>
                </div>

                <div class="mt-2 text-xs text-slate-700">
                  <div class="font-medium">{$_('settings.runtime.workflow.tasksLabel')}</div>
                  <p class="mt-1 text-[11px] text-slate-500">
                    {$_('settings.runtime.workflow.executionMapHint')}
                  </p>
                  {#if item.tasks.length === 0}
                    <div class="text-slate-500">—</div>
                  {:else}
                    <ul class="mt-1 space-y-1">
                      {#each [...item.tasks].sort((a, b) => a.orderIndex - b.orderIndex) as task}
                        <li>
                          {task.orderIndex + 1}. {task.title}
                          <span class="text-slate-400">({task.taskKey})</span>
                          <span class="text-slate-500">
                            · {$_('settings.runtime.workflow.agentLinkLabel')}:
                            {task.agentDefinitionId ?? '—'}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>

                <div class="mt-2 text-xs text-slate-700">
                  <div class="font-medium">{$_('settings.runtime.workflow.placeholdersLabel')}</div>
                  {#if getWorkflowPlaceholderTokens(item).length === 0}
                    <div class="text-slate-500">{$_('settings.runtime.workflow.placeholdersNone')}</div>
                  {:else}
                    <div class="mt-1 flex flex-wrap gap-1.5">
                      {#each getWorkflowPlaceholderTokens(item) as token}
                        <span class="rounded bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                          {token}
                        </span>
                      {/each}
                    </div>
                  {/if}
                </div>

                {#if canEdit}
                  <div class="mt-3 flex flex-wrap gap-2">
                    {#if !isSystemWorkflowConfig(item)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        on:click={() => openWorkflowEditor(item)}
                        data-testid={`workflow-config-edit-${item.key}`}
                      >
                        <Pencil class="w-3 h-3" />
                        {$_('settings.runtime.edit')}
                      </button>
                    {/if}
                    {#if isSystemWorkflowConfig(item) && !hasCopyForWorkflow(item.id)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-blue-300 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                        on:click={() => void copyWorkflow(item)}
                        disabled={isCopying || isSaving}
                      >
                        <Copy class="w-3 h-3" />
                        {$_('settings.runtime.copy')}
                      </button>
                    {/if}
                    {#if isCopiedWorkflowConfig(item)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        on:click={() => void resetWorkflow(item)}
                        disabled={isResettingConfig || isSaving}
                      >
                        <RotateCcw class="w-3 h-3" />
                        {$_('settings.runtime.resetToDefault')}
                      </button>
                    {/if}
                    {#if isUserCreatedWorkflowConfig(item)}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        on:click={() => void deleteWorkflow(item)}
                        disabled={isDeletingConfig || isSaving}
                      >
                        <Trash2 class="w-3 h-3" />
                        {$_('common.delete')}
                      </button>
                    {/if}
                  </div>
                {/if}

                {#if editingWorkflowId === item.id}
                  <div class="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <label
                        class="mb-1 block text-xs font-medium text-slate-700"
                        for={`workflow-name-${item.id}`}
                      >
                        {$_('settings.runtime.nameLabel')}
                      </label>
                      <input
                        id={`workflow-name-${item.id}`}
                        class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        bind:value={workflowDraftById[item.id].name}
                      />
                    </div>
                    <div>
                      <label
                        class="mb-1 block text-xs font-medium text-slate-700"
                        for={`workflow-description-${item.id}`}
                      >
                        {$_('settings.runtime.descriptionLabel')}
                      </label>
                      <textarea
                        id={`workflow-description-${item.id}`}
                        class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        rows={2}
                        bind:value={workflowDraftById[item.id].description}
                      ></textarea>
                    </div>
                    {#if isWorkflowConfigJsonEditable(item)}
                      <div>
                        <label
                          class="mb-1 block text-xs font-medium text-slate-700"
                          for={`workflow-config-json-${item.id}`}
                        >
                          {$_('settings.runtime.configJsonLabel')}
                        </label>
                        <textarea
                          id={`workflow-config-json-${item.id}`}
                          data-testid={`workflow-config-json-editor-${item.key}`}
                          class="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
                          rows={8}
                          bind:value={workflowDraftById[item.id].configText}
                        ></textarea>
                      </div>
                    {:else}
                      <div
                        class="rounded border border-slate-200 bg-slate-100 p-2 text-xs text-slate-600"
                        data-testid={`workflow-config-metadata-only-hint-${item.key}`}
                      >
                        <div class="font-medium text-slate-700">
                          {$_('settings.runtime.workflow.metadataOnlyTitle')}
                        </div>
                        <p class="mt-1">
                          {$_('settings.runtime.workflow.configJsonReadonlyHint')}
                        </p>
                      </div>
                    {/if}
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                        on:click={() => void saveWorkflow(item)}
                        disabled={isSaving}
                      >
                        {$_('settings.runtime.save')}
                      </button>
                      <button
                        type="button"
                        class="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                        on:click={() => (editingWorkflowId = null)}
                      >
                        {$_('settings.runtime.cancel')}
                      </button>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
