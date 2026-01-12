<script lang="ts">
  import { onMount } from 'svelte';
  import { addToast } from '$lib/stores/toast';
  import { apiDelete, apiGet, apiPost, apiPut } from '$lib/utils/api';
  import { session } from '$lib/stores/session';
  import { loadUserWorkspaces, setWorkspaceScope, workspaceScope, type UserWorkspace } from '$lib/stores/workspaceScope';
  import { Check, Eye, EyeOff, Trash2, X } from '@lucide/svelte';

  let creatingWorkspace = false;
  let newWorkspaceName = '';

  let selectedWorkspace: UserWorkspace | null = null;
  let isWorkspaceAdmin = false;
  let allWorkspacesHidden = false;

  let membersLoading = false;
  let membersError: string | null = null;
  let members: Array<{ userId: string; email: string | null; displayName: string | null; role: 'viewer' | 'editor' | 'admin' }> = [];
  let addMemberEmail = '';
  let addMemberRole: 'viewer' | 'editor' | 'admin' = 'viewer';

  $: selectedWorkspace = ($workspaceScope.items || []).find((w) => w.id === $workspaceScope.selectedId) ?? null;
  $: isWorkspaceAdmin = selectedWorkspace?.role === 'admin';
  $: allWorkspacesHidden = ($workspaceScope.items || []).length > 0 && ($workspaceScope.items || []).every((w) => !!w.hiddenAt);

  onMount(async () => {
    if ($session.user?.role === 'admin_app' || !$session.user) return;
    await loadUserWorkspaces();
  });

  async function createWorkspace() {
    const name = newWorkspaceName.trim();
    if (!name) return;
    creatingWorkspace = true;
    try {
      const res = await apiPost<{ id: string }>('/workspaces', { name });
      addToast({ type: 'success', message: 'Workspace créé' });
      newWorkspaceName = '';
      await loadUserWorkspaces();
      if (res?.id) setWorkspaceScope(res.id);
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur création workspace' });
    } finally {
      creatingWorkspace = false;
    }
  }

  async function hideWorkspace(id: string) {
    try {
      await apiPost(`/workspaces/${id}/hide`, {});
      addToast({ type: 'success', message: 'Workspace caché' });
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur hide workspace' });
    }
  }

  async function unhideWorkspace(id: string) {
    try {
      await apiPost(`/workspaces/${id}/unhide`, {});
      addToast({ type: 'success', message: 'Workspace restauré' });
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur unhide workspace' });
    }
  }

  async function deleteWorkspace(id: string) {
    if (!confirm('Supprimer définitivement ce workspace (uniquement possible si caché) ?')) return;
    try {
      await apiDelete(`/workspaces/${id}`);
      addToast({ type: 'success', message: 'Workspace supprimé' });
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur suppression workspace' });
    }
  }

  async function loadMembers() {
    if (!selectedWorkspace?.id) return;
    if (!isWorkspaceAdmin) return;
    membersLoading = true;
    membersError = null;
    try {
      const data = await apiGet<{
        items: Array<{ userId: string; email: string | null; displayName: string | null; role: 'viewer' | 'editor' | 'admin' }>;
      }>(`/workspaces/${selectedWorkspace.id}/members`);
      members = data.items || [];
    } catch (e: any) {
      membersError = e?.message ?? 'Erreur chargement membres';
    } finally {
      membersLoading = false;
    }
  }

  $: if (selectedWorkspace?.id && isWorkspaceAdmin) {
    void loadMembers();
  }

  async function addMember() {
    if (!selectedWorkspace?.id) return;
    const email = addMemberEmail.trim();
    if (!email) return;
    try {
      await apiPost(`/workspaces/${selectedWorkspace.id}/members`, { email, role: addMemberRole });
      addToast({ type: 'success', message: 'Membre ajouté' });
      addMemberEmail = '';
      addMemberRole = 'viewer';
      await loadMembers();
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur ajout membre' });
    }
  }

  async function updateMember(userId: string, role: 'viewer' | 'editor' | 'admin') {
    if (!selectedWorkspace?.id) return;
    try {
      await apiPut(`/workspaces/${selectedWorkspace.id}/members/${userId}`, { role });
      addToast({ type: 'success', message: 'Rôle mis à jour' });
      await loadMembers();
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur update rôle' });
    }
  }

  async function removeMember(userId: string) {
    if (!selectedWorkspace?.id) return;
    if (!confirm('Retirer ce membre du workspace ?')) return;
    try {
      await apiDelete(`/workspaces/${selectedWorkspace.id}/members/${userId}`);
      addToast({ type: 'success', message: 'Membre retiré' });
      await loadMembers();
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur suppression membre' });
    }
  }
</script>

{#if $session.user?.role === 'admin_app'}
  <div class="text-sm text-slate-600">
    La gestion des workspaces (collaboration) n’est pas disponible pour <code>admin_app</code>.
  </div>
{:else}
  {#if allWorkspacesHidden}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Tous vos workspaces sont cachés. Restaurer un workspace (si rôle admin) ou créer un nouveau workspace.
    </div>
  {/if}

  <div class="flex flex-wrap items-end gap-2">
    <label class="block text-sm">
      <div class="text-slate-600">Créer un workspace</div>
      <input
        class="mt-1 w-72 rounded border border-slate-200 px-3 py-2"
        placeholder="Nom du workspace"
        bind:value={newWorkspaceName}
      />
    </label>
    <button
      class="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      on:click={createWorkspace}
      disabled={creatingWorkspace || !newWorkspaceName.trim()}
    >
      Créer
    </button>
  </div>

  <div class="overflow-x-auto rounded border border-slate-200">
    <table class="min-w-full text-sm">
      <thead class="border-b border-slate-200 text-left text-slate-600">
        <tr>
          <th class="w-10 px-3 py-2"></th>
          <th class="px-3 py-2">Nom</th>
          <th class="px-3 py-2">Rôle</th>
          <th class="px-3 py-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each $workspaceScope.items as ws (ws.id)}
          <tr
            class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer {ws.id === $workspaceScope.selectedId ? 'bg-blue-50' : ''}"
            title="Cliquer pour sélectionner ce workspace"
            on:click={() => setWorkspaceScope(ws.id)}
          >
            <td class="px-3 py-2">
              {#if ws.id === $workspaceScope.selectedId}
                <Check class="h-4 w-4 text-slate-900" />
              {/if}
            </td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <span class={ws.hiddenAt ? 'text-slate-500 line-through' : 'text-slate-900'}>{ws.name}</span>
                {#if ws.hiddenAt}
                  <span class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">caché</span>
                {/if}
              </div>
            </td>
            <td class="px-3 py-2">{ws.role}</td>
            <td class="px-3 py-2">
              <div class="flex gap-2">
                {#if ws.role === 'admin'}
                  {#if ws.hiddenAt}
                    <button
                      class="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                      title="Restaurer le workspace"
                      on:click|stopPropagation={() => unhideWorkspace(ws.id)}
                    >
                      <Eye class="h-4 w-4" />
                    </button>
                    <button
                      class="rounded-full p-1 text-rose-600 hover:bg-rose-200 hover:text-rose-700"
                      title="Supprimer définitivement (workspace caché uniquement)"
                      on:click|stopPropagation={() => deleteWorkspace(ws.id)}
                    >
                      <Trash2 class="h-4 w-4" />
                    </button>
                  {:else}
                    <button
                      class="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                      title="Cacher le workspace"
                      on:click|stopPropagation={() => hideWorkspace(ws.id)}
                    >
                      <EyeOff class="h-4 w-4" />
                    </button>
                  {/if}
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if selectedWorkspace && isWorkspaceAdmin}
    <div class="rounded border border-slate-200 p-4">
      <h4 class="font-medium">Membres</h4>
      <div class="mt-3 space-y-3">
        <div class="flex flex-wrap items-end gap-2">
          <label class="block text-sm">
            <div class="text-slate-600">Email</div>
            <input class="mt-1 w-72 rounded border border-slate-200 px-3 py-2" bind:value={addMemberEmail} />
          </label>
          <label class="block text-sm">
            <div class="text-slate-600">Rôle</div>
            <select class="mt-1 rounded border border-slate-200 px-3 py-2" bind:value={addMemberRole}>
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button class="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50" on:click={addMember} disabled={!addMemberEmail.trim()}>
            Ajouter
          </button>
        </div>

        {#if membersLoading}
          <div class="text-sm text-slate-600">Chargement…</div>
        {:else if membersError}
          <div class="text-sm text-rose-700">{membersError}</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="border-b border-slate-200 text-left text-slate-600">
                <tr>
                  <th class="py-2 pr-3">Email</th>
                  <th class="py-2 pr-3">Nom</th>
                  <th class="py-2 pr-3">Rôle</th>
                  <th class="py-2 pr-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {#each members as m (m.userId)}
                  <tr class="border-b border-slate-100">
                    <td class="py-2 pr-3">{m.email ?? '—'}</td>
                    <td class="py-2 pr-3">{m.displayName ?? '—'}</td>
                    <td class="py-2 pr-3">
                      <select
                        class="rounded border border-slate-200 px-2 py-1"
                        value={m.role}
                        on:change={(e) => updateMember(m.userId, (e.currentTarget as HTMLSelectElement).value as any)}
                        disabled={m.userId === $session.user?.id}
                      >
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td class="py-2 pr-3 text-right">
                      {#if m.userId !== $session.user?.id}
                        <button
                          class="rounded-full p-1 text-rose-600 hover:bg-rose-200 hover:text-rose-700"
                          title="Retirer ce membre"
                          on:click={() => removeMember(m.userId)}
                        >
                          <X class="h-4 w-4" />
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}


