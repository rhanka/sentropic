<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { addToast } from '$lib/stores/toast';
  import { getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';
  import type { ContextDocumentItem, DocumentContextType } from '$lib/utils/documents';
  import { deleteDocument, getDownloadUrl, listDocuments, uploadDocument } from '$lib/utils/documents';
  import { Trash2, Download, Eye, EyeOff } from '@lucide/svelte';

  export let contextType: DocumentContextType;
  export let contextId: string;

  let items: ContextDocumentItem[] = [];
  let loading = false;
  let uploading = false;
  let error: string | null = null;
  let expandedSummaryById: Record<string, boolean> = {};

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastContextKey = '';
  let sseKey = '';
  let sseReloadTimer: ReturnType<typeof setTimeout> | null = null;

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    const rounded = i === 0 ? String(Math.round(v)) : v.toFixed(1);
    return `${rounded} ${units[i]}`;
  };

  const statusLabelKey = (s: string) => {
    if (s === 'uploaded') return 'documents.status.uploaded';
    if (s === 'processing') return 'documents.status.processing';
    if (s === 'ready') return 'documents.status.ready';
    if (s === 'failed') return 'documents.status.failed';
    return 'documents.status.unknown';
  };

  const statusPillClass = (s: string) => {
    if (s === 'ready') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'failed') return 'bg-red-50 text-red-700 border-red-200';
    if (s === 'processing') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
  };

  const load = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) loading = true;
    error = null;
    try {
      const scopedWs = getScopedWorkspaceIdForAdmin();
      const res = await listDocuments({ contextType, contextId, workspaceId: scopedWs });
      items = res.items || [];
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error = msg;
      if (!silent) addToast({ type: 'error', message: msg });
    } finally {
      if (!silent) loading = false;
    }
  };

  const ensurePolling = () => {
    const hasPending = items.some((d) => d.status === 'uploaded' || d.status === 'processing');
    if (!hasPending) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void load({ silent: true });
    }, 2500);
  };

  $: ensurePolling();

  // If the context changes (e.g. folder selection changes), reload documents for the new context.
  $: {
    const key = `${contextType}:${contextId}`;
    if (contextId && key !== lastContextKey) {
      lastContextKey = key;
      items = [];
      expandedSummaryById = {};
      void load({ silent: true });
    }
  }

  onMount(() => {
    // Subscribe to job updates: when a related job completes/fails, reload immediately.
    sseKey = `documents:${Math.random().toString(36).slice(2)}`;
    streamHub.setJobUpdates(sseKey, (ev: StreamHubEvent) => {
      if (ev.type !== 'job_update') return;
      const jobIds = new Set(items.map((d) => d.job_id).filter(Boolean) as string[]);
      if (jobIds.size === 0) return;
      if (!jobIds.has(ev.jobId)) return;

      if (sseReloadTimer) clearTimeout(sseReloadTimer);
      sseReloadTimer = setTimeout(() => {
        void load({ silent: true });
      }, 150);
    });
    void load();
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (sseReloadTimer) clearTimeout(sseReloadTimer);
    sseReloadTimer = null;
    if (sseKey) streamHub.delete(sseKey);
    sseKey = '';
  });

  const onPickFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    uploading = true;
    try {
      const scopedWs = getScopedWorkspaceIdForAdmin();
      await uploadDocument({ contextType, contextId, file, workspaceId: scopedWs });
      addToast({ type: 'success', message: $_('documents.upload.success') });
      await load({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: msg });
    } finally {
      uploading = false;
    }
  };

  const toggleSummary = (id: string) => {
    expandedSummaryById = { ...expandedSummaryById, [id]: !expandedSummaryById[id] };
  };

  const download = (docId: string) => {
    const scopedWs = getScopedWorkspaceIdForAdmin();
    const url = getDownloadUrl({ documentId: docId, workspaceId: scopedWs });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (doc: ContextDocumentItem) => {
    if (!confirm($_('documents.delete.confirm'))) return;
    try {
      const scopedWs = getScopedWorkspaceIdForAdmin();
      await deleteDocument({ documentId: doc.id, workspaceId: scopedWs });
      addToast({ type: 'success', message: $_('documents.delete.success') });
      await load({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast({ type: 'error', message: msg });
    }
  };
</script>

<div class="rounded border border-slate-200 bg-white p-4">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h3 class="font-semibold text-slate-900">{$_('documents.title')}</h3>
      <p class="mt-1 text-sm text-slate-600">{$_('documents.subtitle')}</p>
    </div>

    <div class="flex items-center gap-2">
      <button
        class="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        on:click={() => load()}
        disabled={loading || uploading}
      >
        {$_('documents.refresh')}
      </button>

      <label class="rounded bg-primary px-3 py-2 text-sm text-white hover:opacity-90 cursor-pointer disabled:opacity-50">
        <input
          class="hidden"
          type="file"
          on:change={onPickFile}
          disabled={uploading}
        />
        {uploading ? $_('documents.upload.loading') : $_('documents.upload.cta')}
      </label>
    </div>
  </div>

  {#if error}
    <div class="mt-4 rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">
      {error}
    </div>
  {/if}

  <div class="mt-4">
    {#if loading && items.length === 0}
      <div class="text-sm text-slate-500">{$_('documents.loading')}</div>
    {:else if items.length === 0}
      <div class="text-sm text-slate-500">{$_('documents.empty')}</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="py-2 pr-4">{$_('documents.table.name')}</th>
              <th class="py-2 pr-4">{$_('documents.table.size')}</th>
              <th class="py-2 pr-4">{$_('documents.table.status')}</th>
              <th class="py-2">{$_('documents.table.actions')}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each items as doc (doc.id)}
              <tr class="align-top">
                <td class="py-3 pr-4">
                  <div class="font-medium text-slate-900">{doc.filename}</div>
                  <div class="text-xs text-slate-500">{doc.mime_type}</div>
                </td>
                <td class="py-3 pr-4 text-slate-700">{formatBytes(doc.size_bytes)}</td>
                <td class="py-3 pr-4">
                  <span class={"inline-flex items-center rounded-full border px-2 py-1 text-xs " + statusPillClass(doc.status)}>
                    {$_(statusLabelKey(doc.status))}
                  </span>
                </td>
                <td class="py-3">
                  <div class="flex flex-wrap items-center gap-2">
                    {#if doc.status === 'ready'}
                      <button
                        class="text-slate-600 hover:text-slate-900"
                        on:click={() => toggleSummary(doc.id)}
                        title={expandedSummaryById[doc.id]
                          ? $_('documents.action.hideSummary')
                          : $_('documents.action.showSummary')}
                        aria-label={expandedSummaryById[doc.id]
                          ? $_('documents.action.hideSummary')
                          : $_('documents.action.showSummary')}
                      >
                        {#if expandedSummaryById[doc.id]}
                          <EyeOff class="w-4 h-4" />
                        {:else}
                          <Eye class="w-4 h-4" />
                        {/if}
                      </button>
                    {/if}

                    <button
                      class="text-slate-600 hover:text-slate-900"
                      on:click={() => download(doc.id)}
                      title={$_('documents.action.download')}
                      aria-label={$_('documents.action.download')}
                    >
                      <Download class="w-4 h-4" />
                    </button>

                    <button
                      class="text-red-600 hover:text-red-700"
                      on:click={() => remove(doc)}
                      title={$_('documents.delete.cta')}
                      aria-label={$_('documents.delete.cta')}
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>

              {#if expandedSummaryById[doc.id]}
                <tr class="align-top">
                  <td colspan="4" class="pb-3">
                    <div class="rounded bg-slate-50 border border-slate-200 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                      {doc.summary || $_('documents.summary.empty')}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>


