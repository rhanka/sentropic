<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { API_BASE_URL } from '$lib/config';
  import { addToast } from '$lib/stores/toast';
  import {
    getScopedWorkspaceIdForUser,
    loadUserWorkspaces,
    setWorkspaceScope,
    workspaceScope,
  } from '$lib/stores/workspaceScope';
  import { currentFolderId } from '$lib/stores/folders';
  import { Download, Upload, X } from '@lucide/svelte';

  type ExportScope = 'workspace' | 'folder' | 'usecase' | 'organization' | 'matrix';

  export let open = false;
  export let mode: 'export' | 'import' = 'export';
  export let scope: ExportScope = 'workspace';
  export let scopeId: string | null = null;
  export let allowScopeSelect = true;
  export let allowScopeIdEdit = true;
  export let title: string | null = null;
  export let defaultTargetWorkspaceId: string | null = null;
  export let lockTargetWorkspace = false;

  export let defaultIncludeComments = true;
  export let defaultIncludeDocuments = true;
  export let workspaceName: string | null = null;
  export let objectName: string | null = null;
  export let objectLabel: string | null = null;
  export let commentsAvailable: boolean | null = null;
  export let documentsAvailable: boolean | null = null;
  export let includeOptions: Array<{ id: string; label: string; defaultChecked?: boolean }> = [];
  export let fixedInclude: string[] = [];
  export let includeAffectsComments: string[] = [];
  export let includeAffectsDocuments: string[] = [];
  export let includeDependencies: Record<string, string[]> = {};
  export let exportKind: string | null = null;
  export let importObjectTypes: string[] = [];
  export let importTargetType: 'folder' | 'organization' | null = null;
  export let importTargetLabel: string | null = null;
  export let importTargetOptions: Array<{ id: string; label: string }> = [];
  export let defaultImportTargetId: string | null = null;
  export let lockImportTarget = false;

  const dispatch = createEventDispatcher<{ imported: { scope?: string; workspaceId?: string; folderId?: string } }>();

  let includeComments = defaultIncludeComments;
  let includeDocuments = defaultIncludeDocuments;
  let includeExtras: Record<string, boolean> = {};
  let selectedScope: ExportScope = scope;
  let selectedScopeId = scopeId ?? '';
  let isBusy = false;
  let selectedFile: File | null = null;
  let targetWorkspaceId = '';
  let lastOpen = false;
  let importTargetId = '';
  let importPreviewLoading = false;
  let importPreviewError: string | null = null;
  let importPreview: {
    scope?: string;
    objects: {
      organizations: Array<{ id: string; name: string }>;
      folders: Array<{ id: string; name: string }>;
      usecases: Array<{ id: string; name: string }>;
      matrix: Array<{ id: string; name: string }>;
    };
    has_comments?: boolean;
    has_documents?: boolean;
  } | null = null;
  let importSelectedTypes: Record<string, boolean> = {};
  let importIncludeComments = true;
  let importIncludeDocuments = true;
  let importTargetOptionsState: Array<{ id: string; label: string }> = [];
  let lastTargetWorkspaceId = '';
  let lastTargetWorkspaceIdForDefault = '';
  let workspaceTouched = false;

  const scopeOptions: Array<{ value: ExportScope; label: string }> = [
    { value: 'workspace', label: 'Workspace' },
    { value: 'folder', label: 'Dossier' },
    { value: 'usecase', label: "Cas d'usage" },
    { value: 'organization', label: 'Organisation' },
    { value: 'matrix', label: 'Matrice' },
  ];

  $: showCommentsToggle =
    commentsAvailable === null
      ? true
      : commentsAvailable || includeAffectsComments.some((id) => includeExtras[id]);
  $: showDocumentsToggle =
    documentsAvailable === null
      ? true
      : documentsAvailable || includeAffectsDocuments.some((id) => includeExtras[id]);
  const importTypeKeys = ['organizations', 'folders', 'usecases', 'matrix'] as const;
  type ImportTypeKey = typeof importTypeKeys[number];
  $: importAllowedTypes =
    (importObjectTypes.length > 0 ? importObjectTypes : importTypeKeys) as ImportTypeKey[];
  $: importWorkspaceOptions =
    importTargetType ? $workspaceScope.items.filter((ws) => ws.role === 'editor' || ws.role === 'admin') : $workspaceScope.items;

  const close = () => {
    open = false;
  };

  const resetState = () => {
    includeComments = defaultIncludeComments;
    includeDocuments = defaultIncludeDocuments;
    selectedScope = scope;
    selectedScopeId = scopeId ?? '';
    selectedFile = null;
    targetWorkspaceId = defaultTargetWorkspaceId ?? '__new__';
    isBusy = false;
    includeExtras = includeOptions.reduce<Record<string, boolean>>((acc, opt) => {
      acc[opt.id] = opt.defaultChecked ?? false;
      return acc;
    }, {});
    importTargetId = defaultImportTargetId ?? '';
    importPreviewLoading = false;
    importPreviewError = null;
    importPreview = null;
    importSelectedTypes = {};
    importIncludeComments = true;
    importIncludeDocuments = true;
    importTargetOptionsState = importTargetOptions;
    lastTargetWorkspaceId = '';
    lastTargetWorkspaceIdForDefault = '';
    workspaceTouched = false;
  };

  $: if (open && !lastOpen) {
    lastOpen = true;
    resetState();
    if (get(workspaceScope).items.length === 0) {
      void loadUserWorkspaces();
    }
  } else if (!open && lastOpen) {
    lastOpen = false;
  }

  onMount(() => {
    if (get(workspaceScope).items.length === 0) {
      void loadUserWorkspaces();
    }
  });

  const buildScopedUrl = (endpoint: string): string => {
    const rawUrl = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    const scoped = getScopedWorkspaceIdForUser();
    if (!scoped) return rawUrl;
    const url = new URL(rawUrl, window.location.origin);
    if (!url.searchParams.has('workspace_id')) url.searchParams.set('workspace_id', scoped);
    return url.toString();
  };

  const parseDownloadName = (res: Response): string => {
    const header = res.headers.get('Content-Disposition') || '';
    const match = header.match(/filename="([^"]+)"/);
    return match?.[1] || 'export.zip';
  };

  const handleExport = async () => {
    const payloadScope = allowScopeSelect ? selectedScope : scope;
    const payloadScopeId = allowScopeIdEdit ? selectedScopeId.trim() : (scopeId ?? '');
    if (payloadScope !== 'workspace' && !payloadScopeId) {
      addToast({ type: 'error', message: 'Le scope id est requis pour cet export.' });
      return;
    }
    isBusy = true;
    try {
      const extraInclude = Object.entries(includeExtras)
        .filter(([, enabled]) => enabled)
        .flatMap(([id]) => [id, ...(includeDependencies[id] ?? [])]);
      const include = Array.from(
        new Set([
          ...fixedInclude,
          ...(includeComments ? ['comments'] : []),
          ...(includeDocuments ? ['documents'] : []),
          ...extraInclude,
        ])
      );
      const res = await fetch(buildScopedUrl('/exports'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: payloadScope,
          scope_id: payloadScopeId || undefined,
          include_comments: includeComments,
          include_documents: includeDocuments,
          include,
          export_kind: exportKind ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.message ?? 'Erreur export');
      }
      const blob = await res.blob();
      const name = parseDownloadName(res);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addToast({ type: 'success', message: 'Export lancé.' });
      close();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur export' });
    } finally {
      isBusy = false;
    }
  };

  const buildSelectedTypes = () => {
    return Object.entries(importSelectedTypes)
      .filter(([, checked]) => checked)
      .map(([type]) => type);
  };

  const initSelectedTypes = (preview: typeof importPreview) => {
    if (!preview) return;
    const next: Record<string, boolean> = {};
    for (const type of importAllowedTypes) {
      const items = (preview.objects as Record<string, Array<{ id: string }>>)[type] || [];
      next[type] = items.length > 0;
    }
    importSelectedTypes = next;
  };

  const getImportFolderOption = () => {
    const imported = importPreview?.objects?.folders || [];
    if (importTargetType !== 'folder') return null;
    if (imported.length === 0) return null;
    const first = imported[0];
    return { id: `import:${first.id}`, label: `${first.name} (importer)` };
  };

  const isNewWorkspace = () => targetWorkspaceId === '__new__' || targetWorkspaceId === '';

  const getDefaultTargetFolderId = () => {
    if (defaultImportTargetId && targetWorkspaceId === (defaultTargetWorkspaceId ?? '')) {
      if (importTargetOptionsState.find((opt) => opt.id === defaultImportTargetId)) {
        return defaultImportTargetId;
      }
    }
    const importOption = getImportFolderOption();
    return importOption?.id ?? 'new';
  };

  const buildImportTargetOptions = (base: Array<{ id: string; label: string }>) => {
    if (importTargetType !== 'folder') return base;
    const normalizedBase = base.filter((opt) => !opt.id.startsWith('import:') && opt.id !== 'new');
    const options: Array<{ id: string; label: string }> = [];
    const importOption = getImportFolderOption();
    if (importOption) options.push(importOption);
    options.push({ id: 'new', label: 'Créer un nouveau dossier' });
    options.push(...normalizedBase);
    return options;
  };

  const loadImportPreview = async () => {
    if (!selectedFile) {
      addToast({ type: 'error', message: 'Choisir un fichier .zip' });
      return;
    }
    importPreviewLoading = true;
    importPreviewError = null;
    importPreview = null;
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      const res = await fetch(buildScopedUrl('/imports/preview'), {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.message ?? 'Erreur prévisualisation');
      }
      const data = await res.json();
      importPreview = data;
      importIncludeComments = Boolean(data?.has_comments);
      importIncludeDocuments = Boolean(data?.has_documents);
      initSelectedTypes(importPreview);
      if (importTargetType === 'folder') {
        importTargetOptionsState = buildImportTargetOptions(importTargetOptionsState);
        if (!importTargetOptionsState.find((opt) => opt.id === importTargetId)) {
          importTargetId = getDefaultTargetFolderId();
        }
      }
    } catch (e: any) {
      importPreviewError = e?.message ?? 'Erreur prévisualisation';
    } finally {
      importPreviewLoading = false;
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      addToast({ type: 'error', message: 'Choisir un fichier .zip' });
      return;
    }
    if (importPreview) {
      const selectedTypes = buildSelectedTypes();
      if (selectedTypes.length === 0) {
        addToast({ type: 'error', message: 'Sélectionner au moins un type à importer.' });
        return;
      }
    }
    isBusy = true;
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      if (!isNewWorkspace() && targetWorkspaceId.trim()) {
        form.append('target_workspace_id', targetWorkspaceId.trim());
      }
      if (importTargetType === 'folder' && importTargetId) {
        if (importTargetId === 'new') {
          form.append('target_folder_create', 'true');
        } else if (importTargetId.startsWith('import:')) {
          form.append('target_folder_create', 'true');
          form.append('target_folder_source_id', importTargetId.replace('import:', ''));
        } else {
          form.append('target_folder_id', importTargetId);
        }
      }
      const selectedTypes = buildSelectedTypes();
      if (selectedTypes.length > 0) {
        form.append('selected_types', JSON.stringify(selectedTypes));
      }
      form.append('include_comments', String(importIncludeComments));
      form.append('include_documents', String(importIncludeDocuments));
      const res = await fetch(buildScopedUrl('/imports'), {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.message ?? 'Erreur import');
      }
      const data = await res.json();
      addToast({
        type: 'success',
        message: `Import terminé (${data?.scope ?? 'scope'} → ${data?.workspace_id ?? 'workspace'}).`,
      });
      const importedWorkspaceId = typeof data?.workspace_id === 'string' ? data.workspace_id : null;
      const importedFolderId = typeof data?.target_folder_id === 'string' ? data.target_folder_id : null;
      if (importedWorkspaceId) {
        if (isNewWorkspace() || importedWorkspaceId !== targetWorkspaceId) {
          setWorkspaceScope(importedWorkspaceId);
        }
      }
      if (importedFolderId) {
        currentFolderId.set(importedFolderId);
      }
      dispatch('imported', { scope: data?.scope, workspaceId: data?.workspace_id, folderId: importedFolderId ?? undefined });
      close();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur import' });
    } finally {
      isBusy = false;
    }
  };

  const handleFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement | null;
    selectedFile = input?.files?.[0] ?? null;
    importPreview = null;
    importPreviewError = null;
    importSelectedTypes = {};
    importIncludeComments = true;
    importIncludeDocuments = true;
    if (selectedFile) void loadImportPreview();
  };

  const loadImportTargets = async () => {
    if (!importTargetType) return;
    if (isNewWorkspace()) {
      importTargetOptionsState = buildImportTargetOptions([]);
      importTargetId = getDefaultTargetFolderId();
      return;
    }
    if (importTargetType === 'folder') {
      try {
        const url = new URL(`${API_BASE_URL}/folders`);
        url.searchParams.set('workspace_id', targetWorkspaceId);
        const res = await fetch(url.toString(), { credentials: 'include' });
        if (!res.ok) throw new Error('Erreur chargement dossiers');
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        importTargetOptionsState = buildImportTargetOptions(items.map((folder: any) => ({
          id: folder.id,
          label: folder.name || 'Dossier',
        })));
        if (targetWorkspaceId !== lastTargetWorkspaceIdForDefault) {
          lastTargetWorkspaceIdForDefault = targetWorkspaceId;
          importTargetId = getDefaultTargetFolderId();
        } else if (!importTargetOptionsState.find((opt) => opt.id === importTargetId)) {
          importTargetId = importTargetOptionsState[0]?.id ?? '';
        }
      } catch (e: any) {
        importPreviewError = e?.message ?? 'Erreur chargement dossiers';
      } finally {
        // no-op
      }
    }
  };

  $: if (mode === 'import' && importTargetType && targetWorkspaceId !== lastTargetWorkspaceId) {
    lastTargetWorkspaceId = targetWorkspaceId;
    void loadImportTargets();
  }

  $: if (mode === 'import' && !workspaceTouched && defaultTargetWorkspaceId && targetWorkspaceId === '') {
    targetWorkspaceId = defaultTargetWorkspaceId;
  }
</script>

{#if open}
  <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-lg w-full mx-4">
      <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div class="flex items-center gap-2">
          {#if mode === 'export'}
            <Download class="w-4 h-4 text-slate-500" />
          {:else}
            <Upload class="w-4 h-4 text-slate-500" />
          {/if}
          <h3 class="text-lg font-semibold">
            {title ?? (mode === 'export' ? 'Exporter' : 'Importer')}
          </h3>
        </div>
        <button
          class="text-slate-400 hover:text-slate-600"
          aria-label="Fermer"
          type="button"
          on:click={close}
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="px-5 py-4 space-y-4">
        {#if mode === 'export'}
          <div class="grid gap-3">
            <div class="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div class="text-slate-500 text-xs">Workspace</div>
              <div class="text-slate-800 font-medium">{workspaceName || '—'}</div>
            </div>
            {#if objectName}
              <div class="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div class="text-slate-500 text-xs">
                  {objectLabel ?? scopeOptions.find((o) => o.value === scope)?.label ?? 'Objet'}
                </div>
                <div class="text-slate-800 font-medium">{objectName}</div>
              </div>
            {/if}
            {#if includeOptions.length > 0}
              {#each includeOptions as opt}
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" bind:checked={includeExtras[opt.id]} />
                  <span>{opt.label}</span>
                </label>
              {/each}
            {/if}
            {#if showCommentsToggle}
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={includeComments} />
                <span>Inclure les commentaires</span>
              </label>
            {/if}
            {#if showDocumentsToggle}
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={includeDocuments} />
                <span>Inclure les documents</span>
              </label>
            {/if}
          </div>
        {:else}
          <div class="grid gap-3">
            <label class="block text-sm">
              <div class="text-slate-600">Fichier .zip</div>
              <input
                class="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                type="file"
                accept=".zip"
                on:change={handleFileChange}
              />
            </label>
            {#if importPreviewLoading}
              <div class="text-sm text-slate-500">Analyse en cours...</div>
            {/if}
            {#if importPreviewError}
              <div class="text-sm text-rose-600">{importPreviewError}</div>
            {/if}
            {#if importPreview}
              <div class="rounded border border-slate-200 px-3 py-2 text-sm">
                <div class="text-slate-500 text-xs mb-2">Types à importer</div>
                <div class="space-y-1">
                  {#each importAllowedTypes as type}
                    {@const items = importPreview.objects[type] || []}
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        bind:checked={importSelectedTypes[type]}
                        disabled={items.length === 0}
                      />
                      <span>
                        {type === 'organizations'
                          ? 'Organisations'
                          : type === 'folders'
                            ? 'Dossiers'
                            : type === 'usecases'
                              ? "Cas d'usage"
                              : 'Matrices'} ({items.length})
                      </span>
                    </label>
                  {/each}
                </div>
              </div>
              <label class="block text-sm">
                <div class="text-slate-600">Workspace cible</div>
                <select
                  class="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                  bind:value={targetWorkspaceId}
                  disabled={lockTargetWorkspace}
                  on:change={() => (workspaceTouched = true)}
                >
                  <option value="__new__">Créer un nouveau workspace</option>
                  {#each importWorkspaceOptions as ws}
                    <option value={ws.id}>{ws.name} ({ws.role})</option>
                  {/each}
                </select>
              </label>
            {#if importTargetOptionsState.length > 0}
                <label class="block text-sm">
                  <div class="text-slate-600">{importTargetLabel ?? 'Cible'}</div>
                  <select
                    class="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                    bind:value={importTargetId}
                    disabled={lockImportTarget}
                  >
                    {#each importTargetOptionsState as opt}
                      <option value={opt.id}>{opt.label}</option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if importPreview.has_comments}
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" bind:checked={importIncludeComments} />
                  <span>Inclure les commentaires</span>
                </label>
              {/if}
              {#if importPreview.has_documents}
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" bind:checked={importIncludeDocuments} />
                  <span>Inclure les documents</span>
                </label>
              {/if}
            {/if}
            {#if !importPreview}
              <div class="text-[11px] text-slate-500">
                Pour un import d’objet (dossier, cas d’usage, organisation), un workspace cible est requis.
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <button
          class="px-3 py-2 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
          type="button"
          on:click={close}
          disabled={isBusy}
        >
          Annuler
        </button>
        <button
          class="px-3 py-2 rounded bg-slate-900 text-white disabled:opacity-50"
          type="button"
          on:click={mode === 'export' ? handleExport : handleImport}
          disabled={isBusy}
        >
          {mode === 'export' ? 'Exporter' : 'Importer'}
        </button>
      </div>
    </div>
  </div>
{/if}
