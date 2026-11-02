<script lang="ts">
  import { onMount } from 'svelte';
  import WorkspaceMembersScreen from '@sentropic/cluster-mesh/ui/WorkspaceMembersScreen.svelte';
  import { createSentropicIdentityManagementPorts } from '$lib/services/cm-identity-screens';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { addToast } from '$lib/stores/toast';
  import { apiDelete, apiPost, apiPatch } from '$lib/utils/api';
  import { session } from '$lib/stores/session';
  import { hiddenWorkspaceLock, loadUserWorkspaces, setWorkspaceScope, workspaceScope, type UserWorkspace } from '$lib/stores/workspaceScope';
  import { streamHub } from '$lib/stores/streamHub';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import FileMenu from '$lib/components/FileMenu.svelte';
  import ImportExportDialog from '$lib/components/ImportExportDialog.svelte';
  import { Check, Eye, EyeOff, Trash2 } from '@lucide/svelte';
  import WorkspaceCreateDialog from '$lib/components/WorkspaceCreateDialog.svelte';

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


  const HUB_KEY = 'workspace-settings-sse';
  let workspaceReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let membersRefreshVersion = 0;

  const t = (key: string, vars?: Record<string, any>) => get(_)(key, vars);

  function scheduleWorkspaceReload() {
    if (workspaceReloadTimer) return;
    workspaceReloadTimer = setTimeout(async () => {
      workspaceReloadTimer = null;
      await loadUserWorkspaces();
    }, 150);
  }

  function scheduleMembersReload() {
    membersRefreshVersion++;
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

  $: memberPorts = createSentropicIdentityManagementPorts($session.user, (key, options) => $_(key, options), message => confirm(message));
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
    };
  });

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

  <a class="text-primary underline focus-visible:ring-2 focus-visible:ring-primary/30" href="/settings/memberships">{$_('identity.membershipTitle')}</a>

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

{#if selectedWorkspace}
    <WorkspaceMembersScreen ports={memberPorts} workspaceId={selectedWorkspace.id} refreshVersion={membersRefreshVersion} />
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

  <WorkspaceCreateDialog bind:open={showWorkspaceCreateDialog} />

  </div>
