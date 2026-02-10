<script lang="ts">
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost, apiPut } from '$lib/utils/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { session } from '$lib/stores/session';
  import { deactivateAccount, deleteAccount, loadMe, me } from '$lib/stores/me';
  import AdminUsersPanel from '$lib/components/AdminUsersPanel.svelte';
  import WorkspaceSettingsPanel from '$lib/components/WorkspaceSettingsPanel.svelte';
  import { Edit, X } from '@lucide/svelte';

  interface Prompt {
    id: string;
    name: string;
    description: string;
    content: string;
    variables: string[];
  }

  let isResetting = false;
  let prompts: Prompt[] = [];
  let selectedPrompt: Prompt | null = null;
  let showPromptEditor = false;
  let promptContent = '';
  let promptName = '';
  let promptDescription = '';
  let promptVariables: string[] = [];
  
  // Configuration IA
  let aiSettings = {
    concurrency: 10,
    defaultModel: 'gpt-5',
    processingInterval: 1000
  };
  let isLoadingAISettings = false;
  let isSavingAISettings = false;
  
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
    if (isAdmin()) {
    await loadPrompts();
    await loadAISettings();
    await loadQueueStats();
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

  const loadPrompts = async () => {
    try {
      const data = await apiGet<{ prompts: Prompt[] }>('/prompts');
      prompts = data.prompts;
    } catch (error) {
      console.error('Failed to load prompts:', error);
    }
  };

  const openPromptEditor = (prompt: Prompt) => {
    selectedPrompt = prompt;
    promptName = prompt.name;
    promptDescription = prompt.description;
    promptContent = prompt.content;
    promptVariables = [...prompt.variables];
    showPromptEditor = true;
  };

  const extractVariablesFromContent = (content: string): string[] => {
    const matches = content.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      return matches.map((match: string) => match.replace(/\{\{|\}\}/g, '')).filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
    }
    return [];
  };

  $: if (promptContent) {
    promptVariables = extractVariablesFromContent(promptContent);
  }

  const savePrompt = async () => {
    if (!selectedPrompt) return;

    try {
      const updatedPrompt: Prompt = {
        ...selectedPrompt,
        content: promptContent,
        variables: promptVariables
      };

      const updatedPrompts = prompts.map((p: Prompt) => 
        p.id === updatedPrompt.id ? updatedPrompt : p
      );

      await apiPut('/prompts', { prompts: updatedPrompts });
      prompts = updatedPrompts;
      showPromptEditor = false;
      addToast({
        type: 'success',
        message: get(_)('settings.prompts.toast.updated')
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: get(_)('settings.prompts.errors.save')
      });
    }
  };

  const closePromptEditor = () => {
    showPromptEditor = false;
    selectedPrompt = null;
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

  const saveAISettings = async () => {
    isSavingAISettings = true;
    try {
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

  {#if !isAdmin()}
    <div class="rounded border border-slate-200 bg-white p-6">
      <p class="text-sm text-slate-600">{$_('settings.adminOnlyHint')}</p>
    </div>
  {:else}
  
  <!-- Section Gestion des Prompts -->
	  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
	    <h2 class="text-lg font-semibold text-slate-800 mb-4">{$_('settings.promptManagement')}</h2>
	    <p class="text-sm text-slate-600 mb-4">
	      {$_('settings.prompts.description')}
	    </p>
    
    <div class="grid gap-4">
      {#each prompts as prompt}
        <div 
          role="button"
          tabindex="0"
          class="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 cursor-pointer" 
          on:click={() => openPromptEditor(prompt)}
          on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPromptEditor(prompt);
            }
          }}>
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <h3 class="font-medium text-slate-900">{prompt.name}</h3>
              <p class="text-sm text-slate-600 mt-1">{prompt.description}</p>
              <div class="flex gap-2 mt-2">
                {#each prompt.variables as variable}
                  <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {variable}
                  </span>
                {/each}
              </div>
            </div>
            <Edit class="w-5 h-5 text-slate-400" />
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Section Configuration IA -->
	  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
	    <h2 class="text-lg font-semibold text-slate-800 mb-4">{$_('settings.aiConfig')}</h2>
	    <p class="text-sm text-slate-600 mb-4">
	      {$_('settings.ai.description')}
	    </p>
    
    {#if isLoadingAISettings}
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        <p class="text-sm text-blue-700">{$_('settings.aiLoading')}</p>
      </div>
    {:else}
      <div class="grid gap-6 md:grid-cols-2">
        <!-- Modèle par défaut -->
        <div>
          <label for="ai-default-model" class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.aiDefaultModel')}</label>
                  <select 
                    id="ai-default-model"
                    bind:value={aiSettings.defaultModel}
                    class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="gpt-5">GPT-5</option>
                    <option value="gpt-5.2">GPT-5.2</option>
                    <option value="gpt-5-mini">GPT-5 Mini</option>
                    <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
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
	            class="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
    <AdminUsersPanel embeddedTitle="Admin · Utilisateurs (approbations)" />
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
      <p><strong>Version:</strong> 1.0.0</p>
      <p><strong>Base de données:</strong> SQLite</p>
      <p><strong>API:</strong> Hono + Drizzle ORM</p>
      <p><strong>Frontend:</strong> SvelteKit + Tailwind CSS</p>
    </div>
  </div>

  {/if}
</section>

<!-- Modal d'édition des prompts -->
{#if showPromptEditor}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto w-full mx-4">
      <div class="p-6">
	        <div class="flex justify-between items-center mb-6">
	          <h3 class="text-lg font-semibold">{$_('settings.editPrompt')}</h3>
	          <button 
	            on:click={closePromptEditor}
	            aria-label={$_('settings.prompts.closeEditor')}
	            class="text-gray-400 hover:text-gray-600"
	          >
            <X class="w-6 h-6" />
          </button>
        </div>

        <div class="space-y-4">
          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.promptName')}</span>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptName}
            </div>
          </div>

          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.promptDescription')}</span>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptDescription}
            </div>
          </div>

          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.detectedVariables')}</span>
            <div class="flex flex-wrap gap-2">
              {#each promptVariables as variable}
                <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {variable}
                </span>
              {/each}
              {#if promptVariables.length === 0}
                <span class="text-sm text-slate-500 italic">{$_('settings.noVariablesDetected')}</span>
              {/if}
            </div>
          </div>

          <div>
            <label for="prompt-content" class="block text-sm font-medium text-slate-700 mb-2">{$_('settings.promptContent')}</label>
	            <textarea 
	              id="prompt-content"
	              bind:value={promptContent}
	              class="w-full h-96 px-3 py-2 border border-slate-300 rounded-md font-mono text-sm"
	              placeholder={$_('settings.prompts.editorPlaceholder')}
	            ></textarea>
	          </div>
	        </div>

        <div class="flex justify-end gap-3 mt-6">
	          <button 
	            on:click={closePromptEditor}
	            class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
	          >
	            {$_('common.cancel')}
	          </button>
	          <button 
	            on:click={savePrompt}
	            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
	          >
	            {$_('common.save')}
	          </button>
	        </div>
      </div>
    </div>
  </div>
{/if}
