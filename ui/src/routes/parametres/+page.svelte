<script lang="ts">
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost, apiPut } from '$lib/utils/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { session } from '$lib/stores/session';
  import { deactivateAccount, deleteAccount, loadMe, me, updateMe } from '$lib/stores/me';
  import {
    adminWorkspaceScope,
    loadAdminWorkspaces,
    setAdminWorkspaceScope,
    ADMIN_WORKSPACE_ID,
    adminReadOnlyScope
  } from '$lib/stores/adminWorkspaceScope';
  import AdminUsersPanel from '$lib/components/AdminUsersPanel.svelte';
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
    processingInterval: 5000
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
    if (isAdminApp()) {
      void loadAdminWorkspaces();
    }
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

  const onAdminScopeChange = (e: Event) => {
    const v = (e.currentTarget as HTMLSelectElement | null)?.value;
    if (v) setAdminWorkspaceScope(v);
  };

  let savingWorkspace = false;
  let deleting = false;
  let deactivating = false;
  let workspaceName = '';
  let shareWithAdmin = false;

  $: if ($me.data?.workspace) {
    workspaceName = $me.data.workspace.name;
    shareWithAdmin = $me.data.workspace.shareWithAdmin;
  }

  const saveWorkspace = async () => {
    if (!$me.data?.workspace) return;
    savingWorkspace = true;
    try {
      await updateMe(isAdmin() ? { workspaceName } : { workspaceName, shareWithAdmin });
      addToast({ type: 'success', message: 'Paramètres du workspace enregistrés' });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur enregistrement workspace' });
    } finally {
      savingWorkspace = false;
    }
  };

  const handleDeactivate = async () => {
    if (!confirm('Désactiver votre compte ? Vous pourrez demander une réactivation.')) return;
    deactivating = true;
    try {
      await deactivateAccount();
      addToast({ type: 'success', message: 'Compte désactivé. Veuillez vous reconnecter.' });
      await session.logout();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur désactivation' });
    } finally {
      deactivating = false;
    }
  };

  const handleDelete = async () => {
    if (!confirm('SUPPRESSION DÉFINITIVE: supprimer votre compte et toutes vos données immédiatement ?')) return;
    deleting = true;
    try {
      await deleteAccount();
      addToast({ type: 'success', message: 'Compte supprimé.' });
      await session.logout();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur suppression' });
    } finally {
      deleting = false;
    }
  };

  const loadPrompts = async () => {
    try {
      const data = await apiGet<{ prompts: Prompt[] }>('/prompts');
      prompts = data.prompts;
    } catch (error) {
      console.error('Erreur lors du chargement des prompts:', error);
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
        message: 'Prompt mis à jour avec succès !'
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde du prompt'
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
      console.error('Erreur lors du chargement des paramètres IA:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des paramètres IA'
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
        message: 'Paramètres IA mis à jour avec succès !'
      });
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des paramètres IA:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde des paramètres IA'
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
      console.error('Erreur lors du chargement des statistiques de queue:', error);
    }
  };

          const purgeQueue = async (status = 'pending') => {
            let confirmMessage = '';
            if (status === 'pending') {
              confirmMessage = 'Êtes-vous sûr de vouloir purger tous les jobs en attente ? Cette action est irréversible.';
            } else if (status === 'processing') {
              confirmMessage = 'Êtes-vous sûr de vouloir purger tous les jobs en cours (probablement bloqués) ? Cette action est irréversible.';
            } else {
              confirmMessage = 'Êtes-vous sûr de vouloir purger TOUS les jobs de la queue ? Cette action est irréversible.';
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
              console.error('Erreur lors de la purge de la queue:', error);
              addToast({
                type: 'error',
                message: 'Erreur lors de la purge de la queue'
              });
            } finally {
              isPurgingQueue = false;
            }
          };

          const purgeAllQueue = async () => {
            if (!confirm('Êtes-vous sûr de vouloir purger TOUTE la queue (tous les jobs) ? Cette action est irréversible.')) {
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
              console.error('Erreur lors de la purge de la queue:', error);
              addToast({
                type: 'error',
                message: 'Erreur lors de la purge de la queue'
              });
            } finally {
              isPurgingQueue = false;
            }
          };

  const resetAllData = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUTES les données ? Cette action est irréversible.')) {
      return;
    }

    isResetting = true;
    try {
      await apiPost('/admin/reset');

      addToast({
        type: 'success',
        message: 'Toutes les données ont été supprimées avec succès !'
      });

      // Rediriger vers la page d'accueil
      goto('/');
    } catch (error) {
      console.error('Failed to reset data:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la suppression des données'
      });
    } finally {
      isResetting = false;
    }
  };
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Paramètres</h1>

  <!-- Section Compte & Workspace (tous les utilisateurs) -->
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800">Compte & Workspace</h2>

    {#if $me.loading}
      <p class="text-sm text-slate-600">Chargement…</p>
    {:else if $me.error}
      <p class="text-sm text-rose-700">{$me.error}</p>
    {:else if $me.data}
      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded border border-slate-200 p-4">
          <h3 class="font-medium">Compte</h3>
          <div class="mt-2 text-sm text-slate-700 space-y-1">
            <div><span class="text-slate-500">Email:</span> {$me.data.user?.email ?? '—'}</div>
            <div><span class="text-slate-500">Nom:</span> {$me.data.user?.displayName ?? '—'}</div>
            <div><span class="text-slate-500">Role effectif:</span> {$me.data.effectiveRole}</div>
            <div><span class="text-slate-500">Statut:</span> {$me.data.user?.accountStatus}</div>
          </div>
          {#if $me.data.user?.accountStatus === 'pending_admin_approval'}
            <p class="mt-2 text-sm text-amber-700">
              Compte en attente de validation admin (48h). Après expiration: accès lecture seule.
            </p>
          {:else if $me.data.user?.accountStatus === 'approval_expired_readonly'}
            <p class="mt-2 text-sm text-amber-700">
              Validation expirée: accès lecture seule (guest). Un admin peut réactiver.
            </p>
          {/if}
        </div>

        <div class="rounded border border-slate-200 p-4">
          <h3 class="font-medium">Workspace</h3>
          <div class="mt-3 space-y-3">
            {#if $session.user?.role === 'admin_app'}
              <label class="block text-sm">
                <div class="text-slate-600">Contexte admin (lecture)</div>
                <select
                  class="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                  bind:value={$adminWorkspaceScope.selectedId}
                  on:change={onAdminScopeChange}
                >
                  <option value={ADMIN_WORKSPACE_ID}>Admin Workspace</option>
                  {#each $adminWorkspaceScope.items.filter((w) => w.id !== ADMIN_WORKSPACE_ID) as ws (ws.id)}
                    <option value={ws.id}>
                      {(ws.ownerEmail || ws.ownerUserId || '—') + ' — ' + (ws.name || ws.id)}
                    </option>
                  {/each}
                </select>
                {#if $adminReadOnlyScope}
                  <p class="mt-2 text-xs text-amber-700">
                    Workspace partagé : <b>lecture seule</b> (actions destructives désactivées).
                  </p>
                {/if}
              </label>
              <div class="border-t border-slate-100 pt-3"></div>
            {/if}
            <label class="block text-sm">
              <div class="text-slate-600">Nom</div>
              <input class="mt-1 w-full rounded border border-slate-200 px-3 py-2" bind:value={workspaceName} />
            </label>
            {#if !isAdmin()}
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" class="h-4 w-4" bind:checked={shareWithAdmin} />
                <span>Partager mon workspace avec l’administrateur</span>
              </label>
            {/if}
            <div class="flex gap-2">
              <button class="rounded bg-slate-900 px-3 py-2 text-sm text-white" on:click={saveWorkspace} disabled={savingWorkspace}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="rounded border border-rose-200 bg-rose-50 p-4">
        <h3 class="font-medium text-rose-800">Zone dangereuse</h3>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="rounded bg-amber-700 px-3 py-2 text-sm text-white" on:click={handleDeactivate} disabled={deactivating}>
            Désactiver mon compte
          </button>
          <button class="rounded bg-rose-700 px-3 py-2 text-sm text-white" on:click={handleDelete} disabled={deleting}>
            Supprimer mon compte
          </button>
        </div>
      </div>
    {/if}
  </div>

  {#if !isAdmin()}
    <div class="rounded border border-slate-200 bg-white p-6">
      <p class="text-sm text-slate-600">Les paramètres avancés (prompts / IA / queue) sont réservés aux admins.</p>
    </div>
  {:else}
  
  <!-- Section Gestion des Prompts -->
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800 mb-4">Gestion des Prompts IA</h2>
    <p class="text-sm text-slate-600 mb-4">
      Configurez les prompts utilisés par l'IA pour générer du contenu. Cliquez sur un prompt pour le modifier.
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
    <h2 class="text-lg font-semibold text-slate-800 mb-4">Configuration IA</h2>
    <p class="text-sm text-slate-600 mb-4">
      Configurez les paramètres de l'intelligence artificielle et de la queue de traitement.
    </p>
    
    {#if isLoadingAISettings}
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        <p class="text-sm text-blue-700">Chargement des paramètres...</p>
      </div>
    {:else}
      <div class="grid gap-6 md:grid-cols-2">
        <!-- Modèle par défaut -->
        <div>
          <label for="ai-default-model" class="block text-sm font-medium text-slate-700 mb-2">Modèle OpenAI par défaut</label>
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
          <p class="text-xs text-slate-500 mt-1">Modèle utilisé par défaut pour toutes les opérations IA</p>
        </div>

        <!-- Concurrence -->
        <div>
          <label for="ai-concurrency" class="block text-sm font-medium text-slate-700 mb-2">Jobs simultanés</label>
          <input 
            id="ai-concurrency"
            type="number" 
            bind:value={aiSettings.concurrency}
            min="1" 
            max="50"
            class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-slate-500 mt-1">Nombre de jobs IA traités en parallèle (1-50)</p>
        </div>

        <!-- Intervalle de traitement -->
        <div>
          <label for="ai-processing-interval" class="block text-sm font-medium text-slate-700 mb-2">Intervalle de traitement (ms)</label>
          <input 
            id="ai-processing-interval"
            type="number" 
            bind:value={aiSettings.processingInterval}
            min="1000" 
            max="60000"
            step="1000"
            class="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-slate-500 mt-1">Délai entre les cycles de traitement de la queue (1000-60000ms)</p>
        </div>

        <!-- Bouton de sauvegarde -->
        <div class="flex items-end">
          <button 
            on:click={saveAISettings}
            disabled={isSavingAISettings}
            class="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSavingAISettings ? 'Sauvegarde...' : 'Sauvegarder les paramètres'}
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Section Gestion de la Queue -->
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800 mb-4">Gestion de la Queue IA</h2>
    <p class="text-sm text-slate-600 mb-4">
      Surveillez et gérez la queue de traitement des jobs IA.
    </p>
    
    <!-- Statistiques de la queue -->
    <div class="grid gap-4 md:grid-cols-5">
      <div class="bg-slate-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-slate-900">{queueStats.total}</div>
        <div class="text-sm text-slate-600">Total</div>
      </div>
      <div class="bg-orange-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-orange-600">{queueStats.pending}</div>
        <div class="text-sm text-orange-600">En attente</div>
      </div>
      <div class="bg-blue-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-blue-600">{queueStats.processing}</div>
        <div class="text-sm text-blue-600">En cours</div>
      </div>
      <div class="bg-green-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-green-600">{queueStats.completed}</div>
        <div class="text-sm text-green-600">Terminés</div>
      </div>
      <div class="bg-red-50 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-red-600">{queueStats.failed}</div>
        <div class="text-sm text-red-600">Échoués</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex gap-2 flex-wrap">
      <button 
        on:click={loadQueueStats}
        class="px-4 py-2 bg-slate-600 text-white rounded hover:bg-slate-700 transition-colors"
      >
        Actualiser
      </button>
      <button 
        on:click={() => purgeQueue('pending')}
        disabled={isPurgingQueue || queueStats.pending === 0}
        class="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPurgingQueue ? 'Purge...' : `Purger en attente (${queueStats.pending})`}
      </button>
      <button 
        on:click={() => purgeQueue('processing')}
        disabled={isPurgingQueue || queueStats.processing === 0}
        class="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPurgingQueue ? 'Purge...' : `Purger en cours (${queueStats.processing})`}
      </button>
      <button 
        on:click={purgeAllQueue}
        disabled={isPurgingQueue || queueStats.total === 0}
        class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPurgingQueue ? 'Purge...' : `Tout purger (${queueStats.total})`}
      </button>
    </div>
  </div>

  {#if isAdminApp()}
    <!-- Interface admin (utilisateurs) - intégrée dans Paramètres -->
    <AdminUsersPanel embeddedTitle="Admin · Utilisateurs (approbations)" />
  {/if}

  <!-- Section Administration -->
  <div class="rounded border border-red-200 bg-red-50 p-6">
    <h2 class="text-lg font-semibold text-red-800 mb-4">Zone de danger</h2>
    <p class="text-red-700 mb-4">
      Cette section permet de réinitialiser complètement l'application. 
      Toutes les données (entreprises, dossiers, cas d'usage) seront définitivement supprimées.
    </p>
    
    <button 
      class="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
      on:click={resetAllData}
      disabled={isResetting}
    >
      {isResetting ? 'Suppression en cours...' : 'Supprimer toutes les données'}
    </button>
  </div>

  <!-- Section Informations système -->
  <div class="rounded border border-blue-200 bg-blue-50 p-6">
    <h2 class="text-lg font-semibold text-blue-800 mb-4">Informations système</h2>
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
          <h3 class="text-lg font-semibold">Éditer le prompt</h3>
          <button 
            on:click={closePromptEditor}
            aria-label="Fermer l'éditeur de prompt"
            class="text-gray-400 hover:text-gray-600"
          >
            <X class="w-6 h-6" />
          </button>
        </div>

        <div class="space-y-4">
          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">Nom du prompt</span>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptName}
            </div>
          </div>

          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">Description</span>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptDescription}
            </div>
          </div>

          <div>
            <span class="block text-sm font-medium text-slate-700 mb-2">Variables détectées</span>
            <div class="flex flex-wrap gap-2">
              {#each promptVariables as variable}
                <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {variable}
                </span>
              {/each}
              {#if promptVariables.length === 0}
                <span class="text-sm text-slate-500 italic">Aucune variable détectée</span>
              {/if}
            </div>
          </div>

          <div>
            <label for="prompt-content" class="block text-sm font-medium text-slate-700 mb-2">Contenu du prompt</label>
            <textarea 
              id="prompt-content"
              bind:value={promptContent}
              class="w-full h-96 px-3 py-2 border border-slate-300 rounded-md font-mono text-sm"
              placeholder="Entrez le contenu du prompt..."
            ></textarea>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button 
            on:click={closePromptEditor}
            class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
          >
            Annuler
          </button>
          <button 
            on:click={savePrompt}
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
