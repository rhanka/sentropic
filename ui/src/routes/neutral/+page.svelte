<script lang="ts">
  /**
   * Neutral workspace landing page — card-based dashboard showing all user
   * workspaces with type icon, initiative count, and last activity.
   *
   * Fetches data from GET /api/v1/neutral/dashboard.
   */

  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { goto } from '$app/navigation';
  import { apiGet } from '$lib/utils/api';
  import { setWorkspaceScope, workspaceScope } from '$lib/stores/workspaceScope';
  import { Lightbulb, Target, Code2, Home, FileText } from '@lucide/svelte';
  import type { WorkspaceType } from '$lib/stores/workspaceScope';
  import FileMenu from '$lib/components/FileMenu.svelte';

  type DashboardWorkspace = {
    id: string;
    name: string;
    type: WorkspaceType;
    initiativeCount: number;
    folderCount: number;
    lastActivity: string | null;
  };

  let loading = true;
  let dashboardWorkspaces: DashboardWorkspace[] = [];
  let error: string | null = null;

  const WORKSPACE_TYPE_ICONS: Record<WorkspaceType, { icon: any; colorClass: string; borderClass: string; bgClass: string; textClass: string; hoverTextClass: string }> = {
    neutral: { icon: Home, colorClass: 'bg-slate-100 text-slate-500', borderClass: 'border-slate-200', bgClass: 'bg-slate-50', textClass: 'text-slate-800', hoverTextClass: 'group-hover:text-slate-900' },
    'ai-ideas': { icon: Lightbulb, colorClass: 'bg-amber-50 text-amber-600', borderClass: 'border-amber-200', bgClass: 'bg-amber-50', textClass: 'text-amber-800', hoverTextClass: 'group-hover:text-amber-900' },
    opportunity: { icon: Target, colorClass: 'bg-blue-50 text-blue-600', borderClass: 'border-blue-200', bgClass: 'bg-blue-50', textClass: 'text-blue-800', hoverTextClass: 'group-hover:text-blue-900' },
    code: { icon: Code2, colorClass: 'bg-emerald-50 text-emerald-600', borderClass: 'border-emerald-200', bgClass: 'bg-emerald-50', textClass: 'text-emerald-800', hoverTextClass: 'group-hover:text-emerald-900' },
  };

  async function loadDashboard() {
    loading = true;
    error = null;
    try {
      const data = await apiGet<{ workspaces: DashboardWorkspace[] }>('/neutral/dashboard');
      dashboardWorkspaces = data.workspaces ?? [];
    } catch (e: any) {
      error = e?.message ?? 'Failed to load dashboard';
      // Fallback: build from workspace store data
      dashboardWorkspaces = ($workspaceScope.items ?? [])
        .filter((w) => w.type !== 'neutral')
        .map((w) => ({
          id: w.id,
          name: w.name,
          type: w.type,
          initiativeCount: 0,
          folderCount: 0,
          lastActivity: w.createdAt,
        }));
    } finally {
      loading = false;
    }
  }

  function handleWorkspaceClick(ws: DashboardWorkspace) {
    setWorkspaceScope(ws.id);
    goto('/folders');
  }

  function formatRelativeDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return d.toLocaleDateString();
  }

  onMount(() => {
    void loadDashboard();
  });
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">{$_('neutral.dashboardTitle')}</h1>
    <FileMenu
      showNew={true}
      showImport={false}
      showExport={false}
      showPrint={false}
      showDelete={false}
      onNew={() => goto('/settings?action=createWorkspace')}
      triggerTitle={$_('neutral.actions')}
      triggerAriaLabel={$_('neutral.actions')}
    />
  </div>

  {#if error}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">{$_('neutral.loading')}</p>
    </div>
  {:else if dashboardWorkspaces.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <p class="text-sm text-slate-500">{$_('neutral.emptyWorkspaces')}</p>
    </div>
  {:else}
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {#each dashboardWorkspaces as ws}
        {@const cfg = WORKSPACE_TYPE_ICONS[ws.type] ?? WORKSPACE_TYPE_ICONS['ai-ideas']}
        <article
          class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full hover:shadow-md cursor-pointer"
          role="button"
          tabindex="0"
          on:click={() => handleWorkspaceClick(ws)}
          on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleWorkspaceClick(ws);
            }
          }}
        >
          <!-- Header -->
          <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b {cfg.borderClass} {cfg.bgClass} gap-2 rounded-t-lg">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg {cfg.colorClass}">
                <svelte:component this={cfg.icon} class="h-4 w-4" />
              </span>
              <h2 class="text-lg sm:text-xl font-medium truncate {cfg.textClass} {cfg.hoverTextClass} transition-colors">{ws.name}</h2>
            </div>
          </div>

          <!-- Body -->
          <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 text-sm text-slate-500">
              <span class="flex items-center gap-1 whitespace-nowrap">
                <FileText class="w-4 h-4 flex-shrink-0" />
                {ws.initiativeCount} {ws.initiativeCount === 1 ? 'initiative' : 'initiatives'}
              </span>
              <span class="text-xs text-slate-400">
                {ws.folderCount} {ws.folderCount === 1 ? 'folder' : 'folders'}
              </span>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-100">
            <span class="text-xs text-slate-400 whitespace-nowrap">
              {formatRelativeDate(ws.lastActivity)}
            </span>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 whitespace-nowrap">
                {ws.type}
              </span>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
