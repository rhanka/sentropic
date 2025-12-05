<script lang="ts">
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost, apiPut } from '$lib/utils/api';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

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
    await loadPrompts();
    await loadAISettings();
    await loadQueueStats();
  });

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
            <svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
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
                    <option value="gpt-5-mini">GPT-5 Mini</option>
                    <option value="gpt-5-nano">GPT-5 Nano</option>
                    <option value="gpt-4.1">GPT-4.1</option>
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
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
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
