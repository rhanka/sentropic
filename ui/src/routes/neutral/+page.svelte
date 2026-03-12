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
  import ViewTemplateRenderer from '$lib/components/ViewTemplateRenderer.svelte';
  import type { ViewTemplateDescriptor } from '$lib/components/ViewTemplateRenderer.svelte';
  import { Lightbulb, Target, Code2, Home, Plus } from '@lucide/svelte';
  import type { WorkspaceType } from '$lib/stores/workspaceScope';

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

  const WORKSPACE_TYPE_ICONS: Record<WorkspaceType, { icon: any; colorClass: string }> = {
    neutral: { icon: Home, colorClass: 'bg-slate-100 text-slate-500' },
    'ai-ideas': { icon: Lightbulb, colorClass: 'bg-amber-50 text-amber-600' },
    opportunity: { icon: Target, colorClass: 'bg-blue-50 text-blue-600' },
    code: { icon: Code2, colorClass: 'bg-emerald-50 text-emerald-600' },
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

  $: descriptor = {
    mode: 'container',
    title: $_('neutral.dashboardTitle'),
    subtitle: $_('neutral.dashboardSubtitle'),
    items: dashboardWorkspaces,
    columns: [
      { key: 'name', label: $_('neutral.colName'), sortable: true },
      { key: 'type', label: $_('neutral.colType'), sortable: true },
      { key: 'initiativeCount', label: $_('neutral.colInitiatives'), sortable: true },
      { key: 'lastActivity', label: $_('neutral.colLastActivity'), sortable: true },
    ],
    sortKey: 'lastActivity',
    sortDirection: 'desc',
    loading,
    emptyMessage: $_('neutral.emptyWorkspaces'),
    actions: [
      {
        label: $_('neutral.newWorkspace'),
        href: '/settings',
        variant: 'primary',
        icon: Plus,
      },
    ],
    cardRenderer: (item: DashboardWorkspace) => {
      const cfg = WORKSPACE_TYPE_ICONS[item.type] ?? WORKSPACE_TYPE_ICONS['ai-ideas'];
      const badges = [
        {
          label: `${item.initiativeCount} ${item.initiativeCount === 1 ? 'initiative' : 'initiatives'}`,
          colorClass: 'bg-indigo-50 text-indigo-600',
        },
        {
          label: `${item.folderCount} ${item.folderCount === 1 ? 'folder' : 'folders'}`,
          colorClass: 'bg-slate-100 text-slate-600',
        },
      ];
      if (item.lastActivity) {
        badges.push({
          label: formatRelativeDate(item.lastActivity),
          colorClass: 'bg-slate-50 text-slate-400',
        });
      }
      return {
        title: item.name,
        subtitle: item.type,
        icon: cfg.icon,
        iconColorClass: cfg.colorClass,
        badges,
        onClick: () => handleWorkspaceClick(item),
      };
    },
  } as ViewTemplateDescriptor;

  onMount(() => {
    void loadDashboard();
  });
</script>

<section class="space-y-6">
  {#if error}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
      {error}
    </div>
  {/if}

  <ViewTemplateRenderer {descriptor} />
</section>
