<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { apiGet } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';

  type Workspace = {
    id: string;
    name: string;
    shareWithAdmin: boolean;
    ownerUserId: string | null;
    createdAt: string;
    updatedAt: string | null;
  };

  type Company = { id: string; name: string; status?: string };
  type Folder = { id: string; name: string; companyId?: string | null; createdAt: string };
  type UseCase = { id: string; folderId: string; createdAt: string; data: any };

  let loading = false;
  let workspace: Workspace | null = null;
  let companies: Company[] = [];
  let folders: Folder[] = [];
  let useCases: UseCase[] = [];

  $: workspaceId = $page.params.id;

  async function load() {
    loading = true;
    try {
      const [ws, c, f, u] = await Promise.all([
        apiGet<{ workspace: Workspace }>(`/admin/workspaces/${workspaceId}`),
        apiGet<{ items: Company[] }>(`/admin/workspaces/${workspaceId}/companies`),
        apiGet<{ items: Folder[] }>(`/admin/workspaces/${workspaceId}/folders`),
        apiGet<{ items: UseCase[] }>(`/admin/workspaces/${workspaceId}/use-cases`),
      ]);
      workspace = ws.workspace;
      companies = c.items;
      folders = f.items;
      useCases = u.items;
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Accès workspace refusé ou introuvable' });
      workspace = null;
      companies = [];
      folders = [];
      useCases = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="space-y-4">
  <div class="rounded border border-slate-200 bg-white p-4">
    <div class="flex items-center justify-between gap-2">
      <div>
        <h1 class="text-lg font-semibold">Admin · Workspace</h1>
        <p class="text-xs text-slate-500">{workspaceId}</p>
      </div>
      <button class="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" on:click={load} disabled={loading}>
        Rafraîchir
      </button>
    </div>
    {#if loading}
      <div class="mt-3 text-sm text-slate-600">Chargement…</div>
    {:else if workspace}
      <div class="mt-3 text-sm">
        <div><span class="text-slate-500">Nom:</span> {workspace.name}</div>
        <div><span class="text-slate-500">Partagé:</span> {workspace.shareWithAdmin ? 'oui' : 'non'}</div>
        <div><span class="text-slate-500">Owner:</span> {workspace.ownerUserId ?? '—'}</div>
      </div>
    {:else}
      <div class="mt-3 text-sm text-slate-600">Workspace non accessible.</div>
    {/if}
  </div>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    <div class="rounded border border-slate-200 bg-white p-4">
      <h2 class="text-sm font-semibold">Entreprises</h2>
      <div class="mt-2 text-xs text-slate-500">{companies.length} item(s)</div>
      <ul class="mt-3 space-y-1 text-sm">
        {#each companies.slice(0, 20) as c (c.id)}
          <li class="truncate">{c.name} <span class="text-xs text-slate-500">({c.id})</span></li>
        {/each}
      </ul>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      <h2 class="text-sm font-semibold">Dossiers</h2>
      <div class="mt-2 text-xs text-slate-500">{folders.length} item(s)</div>
      <ul class="mt-3 space-y-1 text-sm">
        {#each folders.slice(0, 20) as f (f.id)}
          <li class="truncate">{f.name} <span class="text-xs text-slate-500">({f.id})</span></li>
        {/each}
      </ul>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      <h2 class="text-sm font-semibold">Cas d’usage</h2>
      <div class="mt-2 text-xs text-slate-500">{useCases.length} item(s)</div>
      <ul class="mt-3 space-y-1 text-sm">
        {#each useCases.slice(0, 20) as u (u.id)}
          <li class="truncate">{u.data?.name ?? '—'} <span class="text-xs text-slate-500">({u.id})</span></li>
        {/each}
      </ul>
    </div>
  </div>
</div>


