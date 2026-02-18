<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { addToast } from '$lib/stores/toast';
  import { apiDelete, apiGet, apiPost, apiPatch } from '$lib/utils/api';
  import { session } from '$lib/stores/session';
  import { hiddenWorkspaceLock, loadUserWorkspaces, setWorkspaceScope, workspaceScope, type UserWorkspace } from '$lib/stores/workspaceScope';
  import { streamHub } from '$lib/stores/streamHub';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import FileMenu from '$lib/components/FileMenu.svelte';
  import ImportExportDialog from '$lib/components/ImportExportDialog.svelte';
  import { Check, Eye, EyeOff, Trash2, X } from '@lucide/svelte';

  let creatingWorkspace = false;
  let newWorkspaceName = '';
  let newWorkspaceInputRef: HTMLInputElement | null = null;
  let showWorkspaceExportDialog = false;
  let showWorkspaceImportDialog = false;
  let showWorkspaceCreateDialog = false;

  let selectedWorkspace: UserWorkspace | null = null;
  let isWorkspaceAdmin = false;
  let allWorkspacesHidden = false;
  let noWorkspaces = false;
  let editedSelectedWorkspaceName = '';
  let originalSelectedWorkspaceName = '';
  let lastWorkspaceIdForName: string | null = null;

  let membersError: string | null = null;
  let members: Array<{ userId: string; email: string | null; displayName: string | null; role: 'viewer' | 'commenter' | 'editor' | 'admin' }> = [];
  let addMemberEmail = '';
  let addMemberRole: 'viewer' | 'commenter' | 'editor' | 'admin' = 'viewer';
  let lastMembersWorkspaceId: string | null = null;

  const HUB_KEY = 'workspace-settings-sse';
  let workspaceReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let membersReloadTimer: ReturnType<typeof setTimeout> | null = null;

  const t = (key: string, vars?: Record<string, any>) => get(_)(key, vars);

  function scheduleWorkspaceReload() {
    if (workspaceReloadTimer) return;
    workspaceReloadTimer = setTimeout(async () => {
      workspaceReloadTimer = null;
      await loadUserWorkspaces();
    }, 150);
  }

  function scheduleMembersReload() {
    if (membersReloadTimer) return;
    membersReloadTimer = setTimeout(async () => {
      membersReloadTimer = null;
      await loadMembers();
    }, 150);
  }

  async function handleImportComplete() {
    await loadUserWorkspaces();
  }

  function shouldIgnoreRowClick(event: MouseEvent): boolean {
    const el = event.target as HTMLElement | null;
    if (!el) return false;
    // Ignore clicks coming from interactive elements to avoid re-select/reload blinks
    return Boolean(el.closest('button, a, input, select, textarea, [contenteditable="true"], [data-ignore-row-click]'));
  }

  $: workspaceItems = $workspaceScope.items || [];
  $: workspaceSelectedId = $workspaceScope.selectedId;
  $: selectedWorkspace = (workspaceItems || []).find((w) => w.id === workspaceSelectedId) ?? null;
  $: isWorkspaceAdmin = selectedWorkspace?.role === 'admin';
  $: allWorkspacesHidden = (workspaceItems || []).length > 0 && (workspaceItems || []).every((w) => !!w.hiddenAt);
  $: noWorkspaces = (workspaceItems || []).length === 0;
  $: if (selectedWorkspace?.id !== lastWorkspaceIdForName) {
    lastWorkspaceIdForName = selectedWorkspace?.id ?? null;
    editedSelectedWorkspaceName = selectedWorkspace?.name ?? '';
    originalSelectedWorkspaceName = selectedWorkspace?.name ?? '';
  }

  onMount(() => {
    if ($session.user) {
      void loadUserWorkspaces();
    }

    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type === 'workspace_update') {
        scheduleWorkspaceReload();
        return;
      }
      if (evt?.type === 'workspace_membership_update') {
        scheduleWorkspaceReload();
        if (evt.workspaceId && selectedWorkspace?.id === evt.workspaceId) {
          scheduleMembersReload();
        }
      }
    });

    return () => {
      streamHub.delete(HUB_KEY);
      if (workspaceReloadTimer) clearTimeout(workspaceReloadTimer);
      if (membersReloadTimer) clearTimeout(membersReloadTimer);
    };
  });

  async function createWorkspace() {
    const name = newWorkspaceName.trim();
    if (!name) return;
    creatingWorkspace = true;
    try {
      const res = await apiPost<{ id: string }>('/workspaces', { name });
      addToast({ type: 'success', message: t('workspaceSettings.toasts.created') });
      newWorkspaceName = '';
      await loadUserWorkspaces();
      if (res?.id) setWorkspaceScope(res.id);
      showWorkspaceCreateDialog = false;
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('workspaceSettings.errors.create') });
    } finally {
      creatingWorkspace = false;
    }
  }

  async function hideWorkspace(id: string) {
    try {
      await apiPost(`/workspaces/${id}/hide`, {});
      addToast({ type: 'success', message: t('workspaceSettings.toasts.hidden') });
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('workspaceSettings.errors.hide') });
    }
  }

  async function unhideWorkspace(id: string) {
    try {
      await apiPost(`/workspaces/${id}/unhide`, {});
      addToast({ type: 'success', message: t('workspaceSettings.toasts.unhidden') });
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('workspaceSettings.errors.unhide') });
    }
  }

  async function deleteWorkspace(id: string) {
    if (!confirm(t('workspaceSettings.confirm.deletePermanently'))) return;
    try {
      await apiDelete(`/workspaces/${id}`);
      addToast({ type: 'success', message: t('workspaceSettings.toasts.deleted') });
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('workspaceSettings.errors.delete') });
    }
  }

  async function loadMembers() {
    if (!selectedWorkspace?.id) return;
    if (!isWorkspaceAdmin) return;
    membersError = null;
    try {
      const data = await apiGet<{
        items: Array<{ userId: string; email: string | null; displayName: string | null; role: 'viewer' | 'commenter' | 'editor' | 'admin' }>;
      }>(`/workspaces/${selectedWorkspace.id}/members`);
      members = data.items || [];
    } catch (e: any) {
      membersError = e?.message ?? t('workspaceSettings.errors.loadMembers');
    }
  }

  $: if (selectedWorkspace?.id && isWorkspaceAdmin) {
    if (selectedWorkspace.id !== lastMembersWorkspaceId) {
      lastMembersWorkspaceId = selectedWorkspace.id;
      void loadMembers();
    }
  } else {
    lastMembersWorkspaceId = null;
  }

  async function addMember() {
    if (!selectedWorkspace?.id) return;
    const email = addMemberEmail.trim();
    if (!email) return;
    try {
      await apiPost(`/workspaces/${selectedWorkspace.id}/members`, { email, role: addMemberRole });
      addToast({ type: 'success', message: t('workspaceSettings.toasts.memberAdded') });
      addMemberEmail = '';
      addMemberRole = 'viewer';
      await loadMembers();
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('workspaceSettings.errors.addMember') });
    }
  }

  async function updateMember(userId: string, role: 'viewer' | 'commenter' | 'editor' | 'admin') {
    if (!selectedWorkspace?.id) return;
    try {
      await apiPatch(`/workspaces/${selectedWorkspace.id}/members/${userId}`, { role });
      addToast({ type: 'success', message: t('workspaceSettings.toasts.roleUpdated') });
      await loadMembers();
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('workspaceSettings.errors.updateRole') });
    }
  }

  function handleMemberRoleChange(event: Event, userId: string) {
    const role = (event.currentTarget as HTMLSelectElement).value as 'viewer' | 'commenter' | 'editor' | 'admin';
    void updateMember(userId, role);
  }

  async function removeMember(userId: string) {
    if (!selectedWorkspace?.id) return;
    if (!confirm(t('workspaceSettings.confirm.removeMember'))) return;
    try {
      await apiDelete(`/workspaces/${selectedWorkspace.id}/members/${userId}`);
      addToast({ type: 'success', message: t('workspaceSettings.toasts.memberRemoved') });
      await loadMembers();
      await loadUserWorkspaces();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('workspaceSettings.errors.removeMember') });
    }
  }

  async function handleWorkspaceNameSaved() {
    originalSelectedWorkspaceName = editedSelectedWorkspaceName;
    addToast({ type: 'success', message: t('workspaceSettings.toasts.nameUpdated') });
    await loadUserWorkspaces();
  }
</script>

  <div class="relative">
    <div class="absolute -top-9 right-0">
      <FileMenu
        showNew={true}
        showImport={true}
        showExport={true}
        showPrint={false}
        showDelete={false}
        disabledExport={!isWorkspaceAdmin}
        onNew={() => (showWorkspaceCreateDialog = true)}
        onImport={() => (showWorkspaceImportDialog = true)}
        onExport={() => (showWorkspaceExportDialog = true)}
        triggerTitle={$_('workspaceSettings.actionsMenu')}
        triggerAriaLabel={$_('workspaceSettings.actionsMenu')}
      />
    </div>

  {#if $hiddenWorkspaceLock}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {$_('workspaceSettings.banners.hiddenWorkspace')}
    </div>
  {/if}

  {#if noWorkspaces}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {$_('workspaceSettings.banners.noWorkspaces')}
    </div>
  {/if}

  {#if allWorkspacesHidden && !$hiddenWorkspaceLock}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {$_('workspaceSettings.banners.allHidden')}
    </div>
  {/if}

  {#if !noWorkspaces}
    <div class="overflow-x-auto rounded border border-slate-200">
      <table class="min-w-full text-sm">
        <thead class="border-b border-slate-200 text-left text-slate-600">
          <tr>
            <th class="w-10 px-3 py-2"></th>
            <th class="px-3 py-2">{$_('common.name')}</th>
            <th class="px-3 py-2">{$_('common.role')}</th>
            <th class="px-3 py-2">{$_('common.visibility')}</th>
            <th class="w-10 px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
        {#each workspaceItems as ws (ws.id)}
            <tr
            class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer {ws.id === workspaceSelectedId ? 'bg-blue-50' : ''}"
              title={$_('workspaceSettings.table.selectWorkspace')}
              on:click={(e) => {
                if (shouldIgnoreRowClick(e)) return;
              if (ws.id === workspaceSelectedId) return;
              setWorkspaceScope(ws.id);
              }}
            >
              <td class="px-3 py-2">
              {#if ws.id === workspaceSelectedId}
                  <Check class="h-4 w-4 text-slate-900" />
                {/if}
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                {#if ws.id === workspaceSelectedId && ws.role === 'admin'}
                    <div class="flex-1 min-w-0 w-full" data-ignore-row-click>
                      <EditableInput
                        label=""
                        value={editedSelectedWorkspaceName}
                        markdown={false}
                        multiline={false}
                        fullWidth={true}
                        apiEndpoint={`/workspaces/${ws.id}`}
                        fullData={{ name: editedSelectedWorkspaceName }}
                        changeId={`workspace-name-${ws.id}`}
                        originalValue={originalSelectedWorkspaceName}
                        on:change={(e) => editedSelectedWorkspaceName = e.detail.value}
                        on:saved={handleWorkspaceNameSaved}
                      />
                    </div>
                  {:else}
                    <span class={ws.hiddenAt ? 'text-slate-500 line-through' : 'text-slate-900'}>{ws.name}</span>
                  {/if}
                  {#if ws.hiddenAt}
                    <span class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{$_('common.hidden')}</span>
                  {/if}
                </div>
              </td>
              <td class="px-3 py-2">{$_(`roles.${ws.role}`)}</td>
              <td class="px-3 py-2">
                {#if ws.role === 'admin'}
                  {#if ws.hiddenAt}
                  <button
                    class="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                      title={$_('workspaceSettings.actions.unhide')}
                      on:click|stopPropagation={() => unhideWorkspace(ws.id)}
                    >
                      <EyeOff class="h-4 w-4" />
                    </button>
                  {:else}
                  <button
                    class="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                      title={$_('workspaceSettings.actions.hide')}
                      on:click|stopPropagation={() => hideWorkspace(ws.id)}
                    >
                      <Eye class="h-4 w-4" />
                    </button>
                  {/if}
                {:else}
                <button
                  class="rounded p-1 text-slate-300 cursor-not-allowed"
                    title={$_('common.adminOnly')}
                    disabled
                    data-ignore-row-click
                  >
                    <Eye class="h-4 w-4" />
                  </button>
                {/if}
              </td>
              <td class="px-3 py-2">
                {#if ws.role === 'admin'}
                <button
                  class="rounded p-1 {ws.hiddenAt ? 'text-rose-600 hover:bg-rose-200 hover:text-rose-700' : 'text-slate-300 cursor-not-allowed'}"
                    title={ws.hiddenAt ? $_('workspaceSettings.actions.deletePermanently') : $_('workspaceSettings.actions.deletePermanentlyDisabled')}
                    disabled={!ws.hiddenAt}
                    on:click|stopPropagation={() => deleteWorkspace(ws.id)}
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                {:else}
                <button
                  class="rounded p-1 text-slate-300 cursor-not-allowed"
                    title={$_('common.adminOnly')}
                    disabled
                    data-ignore-row-click
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

{#if selectedWorkspace && isWorkspaceAdmin}
    <div class="rounded border border-slate-200 p-4">
      <h4 class="font-medium">{$_('workspaceSettings.members.title')}</h4>
      <div class="mt-3 space-y-3">
        <div class="flex flex-wrap items-end gap-2">
          <label class="block text-sm">
            <div class="text-slate-600">{$_('common.email')}</div>
            <input class="mt-1 w-72 rounded border border-slate-200 px-3 py-2" bind:value={addMemberEmail} />
          </label>
          <label class="block text-sm">
            <div class="text-slate-600">{$_('common.role')}</div>
            <select class="mt-1 rounded border border-slate-200 px-3 py-2" bind:value={addMemberRole}>
              <option value="viewer">{$_('roles.viewer')}</option>
              <option value="commenter">{$_('roles.commenter')}</option>
              <option value="editor">{$_('roles.editor')}</option>
              <option value="admin">{$_('roles.admin')}</option>
            </select>
          </label>
          <button class="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50" on:click={addMember} disabled={!addMemberEmail.trim()}>
            {$_('common.add')}
          </button>
        </div>

        {#if membersError}
          <div class="text-sm text-rose-700">{membersError}</div>
        {/if}
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="border-b border-slate-200 text-left text-slate-600">
              <tr>
                <th class="py-2 pr-3">{$_('common.email')}</th>
                <th class="py-2 pr-3">{$_('common.name')}</th>
                <th class="py-2 pr-3">{$_('common.role')}</th>
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
                      on:change={(e) => handleMemberRoleChange(e, m.userId)}
                      disabled={m.userId === $session.user?.id}
                    >
                      <option value="viewer">{$_('roles.viewer')}</option>
                      <option value="commenter">{$_('roles.commenter')}</option>
                      <option value="editor">{$_('roles.editor')}</option>
                      <option value="admin">{$_('roles.admin')}</option>
                    </select>
                  </td>
                  <td class="py-2 pr-3 text-right">
                    {#if m.userId !== $session.user?.id}
                      <button
                        class="rounded p-1 text-rose-600 hover:bg-rose-200 hover:text-rose-700"
                        title={$_('workspaceSettings.members.remove')}
                        on:click={() => removeMember(m.userId)}
                      >
                        <Trash2 class="h-4 w-4" />
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {/if}

  <ImportExportDialog
    bind:open={showWorkspaceExportDialog}
    mode="export"
    title={$_('workspaceSettings.export.title')}
    scope="workspace"
    allowScopeSelect={false}
    allowScopeIdEdit={false}
    workspaceName={selectedWorkspace?.name ?? ''}
    includeOptions={[
      { id: 'organizations', label: $_('workspaceSettings.export.include.organizations'), defaultChecked: true },
      { id: 'folders', label: $_('workspaceSettings.export.include.folders'), defaultChecked: true },
      { id: 'usecases', label: $_('workspaceSettings.export.include.usecases'), defaultChecked: true },
      { id: 'matrix', label: $_('workspaceSettings.export.include.matrix'), defaultChecked: true },
    ]}
  />

  <ImportExportDialog
    bind:open={showWorkspaceImportDialog}
    mode="import"
    title={$_('workspaceSettings.import.title')}
    scope="workspace"
    allowScopeSelect={true}
    allowScopeIdEdit={true}
    on:imported={handleImportComplete}
  />

  {#if showWorkspaceCreateDialog}
    <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg max-w-md w-full mx-4">
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 class="text-lg font-semibold">{$_('workspaceSettings.createDialog.title')}</h3>
          <button
            class="text-slate-400 hover:text-slate-600"
            aria-label={$_('common.close')}
            type="button"
            on:click={() => (showWorkspaceCreateDialog = false)}
          >
            <X class="w-5 h-5" />
          </button>
        </div>
        <div class="px-5 py-4 space-y-4">
          <label class="block text-sm">
            <div class="text-slate-600">{$_('workspaceSettings.createDialog.nameLabel')}</div>
            <input
              class="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder={$_('workspaceSettings.createDialog.namePlaceholder')}
              bind:value={newWorkspaceName}
              bind:this={newWorkspaceInputRef}
            />
          </label>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            class="px-3 py-2 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
            type="button"
            on:click={() => (showWorkspaceCreateDialog = false)}
          >
            {$_('common.cancel')}
          </button>
          <button
            class="px-3 py-2 rounded bg-primary text-white disabled:opacity-50"
            type="button"
            on:click={createWorkspace}
            disabled={creatingWorkspace || !newWorkspaceName.trim()}
          >
            {$_('common.create')}
          </button>
        </div>
      </div>
    </div>
  {/if}

  </div>
