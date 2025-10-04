<script lang="ts">
  import { settingsStore } from '$lib/stores/settings';
  import { addToast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';

  let draft = get(settingsStore);
  let openaiModelsText = JSON.stringify(draft.openaiModels, null, 2);
  let isResetting = false;
  let prompts = [];
  let selectedPrompt = null;
  let showPromptEditor = false;
  let promptContent = '';
  let promptName = '';
  let promptDescription = '';
  let promptVariables = [];

  onMount(async () => {
    await loadPrompts();
  });

  const loadPrompts = async () => {
    try {
      const response = await fetch('http://localhost:8787/api/v1/prompts');
      if (response.ok) {
        const data = await response.json();
        prompts = data.prompts;
      }
    } catch (error) {
      console.error('Erreur lors du chargement des prompts:', error);
    }
  };

  const save = () => {
    try {
      draft = {
        ...draft,
        openaiModels: JSON.parse(openaiModelsText)
      };
      settingsStore.set(draft);
      addToast({
        type: 'success',
        message: 'Paramètres enregistrés avec succès !'
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'JSON invalide pour les modèles OpenAI.'
      });
    }
  };

  const openPromptEditor = (prompt) => {
    selectedPrompt = prompt;
    promptName = prompt.name;
    promptDescription = prompt.description;
    promptContent = prompt.content;
    promptVariables = [...prompt.variables];
    showPromptEditor = true;
  };

  const extractVariablesFromContent = (content) => {
    const matches = content.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      return matches.map(match => match.replace(/\{\{|\}\}/g, '')).filter((value, index, self) => self.indexOf(value) === index);
    }
    return [];
  };

  $: if (promptContent) {
    promptVariables = extractVariablesFromContent(promptContent);
  }

  const savePrompt = async () => {
    try {
      const updatedPrompt = {
        ...selectedPrompt,
        content: promptContent,
        variables: promptVariables
      };

      const updatedPrompts = prompts.map(p => 
        p.id === selectedPrompt.id ? updatedPrompt : p
      );

      const response = await fetch('http://localhost:8787/api/v1/prompts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompts: updatedPrompts })
      });

      if (response.ok) {
        prompts = updatedPrompts;
        showPromptEditor = false;
        addToast({
          type: 'success',
          message: 'Prompt mis à jour avec succès !'
        });
      } else {
        throw new Error('Erreur lors de la sauvegarde');
      }
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

  const resetAllData = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUTES les données ? Cette action est irréversible.')) {
      return;
    }

    isResetting = true;
    try {
      const response = await fetch('http://localhost:8787/api/v1/admin/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to reset data');
      }

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
  
  <!-- Section Paramètres -->
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800 mb-4">Configuration</h2>
    <label class="block space-y-2">
      <span class="text-sm font-medium text-slate-700">Modèles OpenAI</span>
      <textarea
        class="h-32 w-full rounded border border-slate-300 p-2 font-mono text-sm"
        bind:value={openaiModelsText}
      ></textarea>
    </label>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={save}>Enregistrer</button>
  </div>

  <!-- Section Gestion des Prompts -->
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-slate-800 mb-4">Gestion des Prompts IA</h2>
    <p class="text-sm text-slate-600 mb-4">
      Configurez les prompts utilisés par l'IA pour générer du contenu. Cliquez sur un prompt pour le modifier.
    </p>
    
    <div class="grid gap-4">
      {#each prompts as prompt}
        <div class="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 cursor-pointer" on:click={() => openPromptEditor(prompt)}>
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
            class="text-gray-400 hover:text-gray-600"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-2">Nom du prompt</label>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptName}
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 mb-2">Description</label>
            <div class="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600">
              {promptDescription}
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 mb-2">Variables détectées</label>
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
            <label class="block text-sm font-medium text-slate-700 mb-2">Contenu du prompt</label>
            <textarea 
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
