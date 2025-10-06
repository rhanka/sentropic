<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { useCasesStore } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import ScoreCard from '$lib/components/ScoreCard.svelte';
  import References from '$lib/components/References.svelte';
  import MatrixDetails from '$lib/components/MatrixDetails.svelte';
  import { calculateUseCaseScores, scoreToStars } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { refreshManager } from '$lib/stores/refresh';

  let useCase: any = undefined;
  let isEditing = false;
  let draft: any = {};
  let error = '';
  let matrix: MatrixConfig | null = null;
  let calculatedScores: any = null;

  $: useCaseId = $page.params.id;

  // Réactivité pour détecter les changements de statut et gérer l'actualisation
  $: if (useCase) {
    const isGenerating = useCase.status === 'generating' || useCase.status === 'detailing';
    
    if (isGenerating) {
      // Démarrer l'actualisation légère si ce n'est pas déjà fait
      if (!refreshManager.isRefreshActive(`useCase-${useCase.id}`)) {
        refreshManager.startUseCaseDetailRefresh(useCase.id, async () => {
          await refreshUseCaseStatus();
        });
      }
    } else {
      // Arrêter l'actualisation si la génération est terminée
      refreshManager.stopRefresh(`useCase-${useCase.id}`);
    }
  }

  onMount(async () => {
    await loadUseCase();
    // Démarrer l'actualisation automatique si le cas d'usage est en génération
    startAutoRefresh();
  });

  onDestroy(() => {
    // Arrêter tous les refreshes quand on quitte la page
    refreshManager.stopAllRefreshes();
  });

  const loadUseCase = async () => {
    try {
      // Charger depuis l'API pour avoir les données les plus récentes
      const response = await fetch(`http://localhost:8787/api/v1/use-cases/${useCaseId}`);
      if (response.ok) {
        useCase = await response.json();
        
        // Mettre à jour le store avec les données fraîches
        useCasesStore.update(items => 
          items.map(uc => uc.id === useCaseId ? useCase : uc)
        );
        
        if (useCase) {
          draft = { ...useCase };
          await loadMatrixAndCalculateScores();
        }
      } else {
        // Fallback sur le store local si l'API échoue
        const useCases = $useCasesStore;
        useCase = useCases.find(uc => uc.id === useCaseId);
        
        if (!useCase) {
          addToast({ type: 'error', message: 'Cas d\'usage non trouvé' });
          error = 'Cas d\'usage non trouvé';
          return;
        }
        
        draft = { ...useCase };
        await loadMatrixAndCalculateScores();
      }
    } catch (err) {
      console.error('Failed to fetch use case:', err);
      // Fallback sur le store local en cas d'erreur
      const useCases = $useCasesStore;
      useCase = useCases.find(uc => uc.id === useCaseId);
      
      if (!useCase) {
        addToast({ type: 'error', message: 'Erreur lors du chargement du cas d\'usage' });
        error = 'Erreur lors du chargement du cas d\'usage';
        return;
      }
      
      draft = { ...useCase };
      await loadMatrixAndCalculateScores();
    }
  };

  // Refresh léger du cas d'usage - met à jour seulement les champs qui changent
  const refreshUseCaseStatus = async () => {
    try {
      const response = await fetch(`http://localhost:8787/api/v1/use-cases/${useCaseId}`);
      if (response.ok) {
        const updatedUseCase = await response.json();
        
        // Mettre à jour seulement les champs qui changent (status, etc.)
        if (useCase) {
          useCase = { ...useCase, ...updatedUseCase };
          draft = { ...useCase };
          
          // Mettre à jour le store
          useCasesStore.update(items => 
            items.map(uc => uc.id === useCaseId ? useCase : uc)
          );
        }
      }
    } catch (error) {
      console.error('Failed to refresh use case status:', error);
    }
  };

  const handleUpdateUseCase = async () => {
    if (!useCase || !draft.name?.trim()) return;

    try {
      useCasesStore.update(items => items.map(uc => uc.id === useCase.id ? { ...uc, ...draft } : uc));
      useCase = { ...useCase, ...draft };
      isEditing = false;
      addToast({ type: 'success', message: 'Cas d\'usage mis à jour avec succès !' });
    } catch (err) {
      console.error('Failed to update use case:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la mise à jour' });
    }
  };

  const handleDelete = async () => {
    if (!useCase || !confirm('Êtes-vous sûr de vouloir supprimer ce cas d\'usage ?')) return;

    try {
      useCasesStore.update(items => items.filter(uc => uc.id !== useCase?.id));
      addToast({ type: 'success', message: 'Cas d\'usage supprimé avec succès !' });
      goto('/cas-usage');
    } catch (err) {
      console.error('Failed to delete use case:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la suppression' });
    }
  };

  const handleCancel = () => {
    if (useCase) {
      draft = { ...useCase };
    }
    isEditing = false;
    error = '';
  };

  const loadMatrixAndCalculateScores = async () => {
    if (!useCase?.folderId) return;
    
    try {
      // Charger la matrice depuis le dossier
      const response = await fetch(`http://localhost:8787/api/v1/folders/${useCase.folderId}`);
      if (response.ok) {
        const folder = await response.json();
        matrix = folder.matrixConfig;
        
        if (matrix && useCase.valueScores && useCase.complexityScores) {
          calculatedScores = calculateUseCaseScores(
            matrix,
            useCase.valueScores,
            useCase.complexityScores
          );
        }
      }
    } catch (err) {
      console.error('Failed to load matrix:', err);
    }
  };

  const startAutoRefresh = () => {
    // Vérifier si le cas d'usage est en génération
    if (useCase && (useCase.status === 'generating' || useCase.status === 'detailing' || useCase.status === 'pending')) {
      // Démarrer l'actualisation légère pour ce cas d'usage spécifique
      refreshManager.startUseCaseDetailRefresh(useCase.id, async () => {
        await refreshUseCaseStatus();
      });
    }
  };
</script>

<section class="space-y-6">
  {#if error}
    <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
      {error}
    </div>
  {/if}

  {#if useCase}
    <div class="space-y-6">
      <!-- Status Banner pour génération en cours -->
      {#if useCase.status === 'generating' || useCase.status === 'detailing' || useCase.status === 'pending'}
        <div class="rounded border border-blue-200 bg-blue-50 p-4">
          <div class="flex items-center gap-3">
            <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            <p class="text-sm text-blue-700 font-medium">
              {#if useCase.status === 'detailing'}
                Détail en cours de génération...
              {:else if useCase.status === 'generating'}
                Cas d'usage en cours de génération...
              {:else if useCase.status === 'pending'}
                Génération en attente...
              {/if}
            </p>
          </div>
        </div>
      {/if}

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-semibold">
            {#if isEditing}
              <input 
                class="text-3xl font-semibold bg-transparent border-b-2 border-blue-500 outline-none"
                bind:value={draft.name}
              />
            {:else}
              {useCase.name}
            {/if}
          </h1>
        </div>
        
        <div class="flex gap-2">
          {#if isEditing}
            <button 
              class="rounded bg-primary px-4 py-2 text-white"
              on:click={handleUpdateUseCase}
              disabled={!draft.name?.trim()}
            >
              Enregistrer
            </button>
            <button 
              class="rounded border border-slate-300 px-4 py-2"
              on:click={handleCancel}
            >
              Annuler
            </button>
          {:else}
            <button 
              class="rounded bg-blue-500 px-4 py-2 text-white"
              on:click={() => isEditing = true}
            >
              Modifier
            </button>
            <button 
              class="rounded bg-red-500 px-4 py-2 text-white"
              on:click={handleDelete}
            >
              Supprimer
            </button>
          {/if}
        </div>
      </div>

      <!-- Scores calculés en 2 colonnes séparées -->
      {#if calculatedScores}
        <div class="grid gap-6 md:grid-cols-2">
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Valeur calculée
              </h3>
            </div>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-1">
                {#each Array(5) as _, i}
                  <svg class="w-6 h-6 {i < calculatedScores.valueStars ? 'text-yellow-400' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                {/each}
              </div>
              <span class="text-lg font-bold text-green-600">
                ({calculatedScores.finalValueScore.toFixed(1)} points)
              </span>
            </div>
          </div>
          
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                </svg>
                Complexité calculée
              </h3>
            </div>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-1">
                {#each Array(5) as _, i}
                  {#if i < calculatedScores.complexityStars}
                    <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                  {:else}
                    <svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                    </svg>
                  {/if}
                {/each}
              </div>
              <span class="text-lg font-bold text-red-600">
                ({calculatedScores.finalComplexityScore.toFixed(1)} points)
              </span>
            </div>
          </div>
        </div>
      {/if}

      <!-- Description sur 2/3 colonnes -->
      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Description (2 colonnes) -->
        <div class="lg:col-span-2">
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                Description
              </h3>
            </div>
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Description du cas d'usage"
                  bind:value={draft.description}
                  rows="6"
                ></textarea>
              </div>
            {:else}
              <p class="text-slate-600 text-sm leading-relaxed">{useCase.description}</p>
            {/if}
          </div>
        </div>

        <!-- Informations (1 colonne) -->
        <div>
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Informations
              </h3>
            </div>
            <div class="space-y-3 text-sm">
              {#if useCase.contact}
                <div>
                  <span class="font-medium text-slate-700">Contact:</span>
                  <span class="text-slate-600 ml-2">{useCase.contact}</span>
                </div>
              {/if}
              {#if useCase.deadline}
                <div>
                  <span class="font-medium text-slate-700">Délai:</span>
                  <span class="text-slate-600 ml-2">{useCase.deadline}</span>
                </div>
              {/if}
              {#if useCase.technologies && useCase.technologies.length > 0}
                <div>
                  <span class="font-medium text-slate-700">Technologies:</span>
                  <ul class="text-slate-600 ml-4 mt-1 list-disc">
                    {#each useCase.technologies as tech}
                      <li class="text-sm">{tech}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if useCase.process}
                <div>
                  <span class="font-medium text-slate-700">Domaine:</span>
                  <span class="text-slate-600 ml-2">{useCase.process}</span>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Layout 3 colonnes pour le reste -->
      <div class="grid gap-6 lg:grid-cols-3">
        <!-- COLONNE 1 -->
        <div class="space-y-6">

          <!-- Bénéfices -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                </svg>
                Bénéfices recherchés
              </h3>
            </div>
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Bénéfices (un par ligne)</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Bénéfice 1&#10;Bénéfice 2&#10;..."
                  bind:value={draft.benefitsText}
                  rows="3"
                ></textarea>
              </div>
            {:else}
              <ul class="space-y-2">
                {#each useCase.benefits || [] as benefit}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <span class="text-green-500 mt-1">•</span>
                    <span>{benefit}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- Risques -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                </svg>
                Risques
              </h3>
            </div>
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Risques (un par ligne)</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Risque 1&#10;Risque 2&#10;..."
                  bind:value={draft.risksText}
                  rows="3"
                ></textarea>
              </div>
            {:else}
              <ul class="space-y-2">
                {#each useCase.risks || [] as risk}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <span class="text-red-500 mt-1">•</span>
                    <span>{risk}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>

        <!-- COLONNE 2 -->
        <div class="space-y-6">
          <!-- Métriques -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-blue-100 text-blue-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                </svg>
                Mesures du succès
              </h3>
            </div>
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Métriques (une par ligne)</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Métrique 1&#10;Métrique 2&#10;..."
                  bind:value={draft.metricsText}
                  rows="3"
                ></textarea>
              </div>
            {:else}
              <ul class="space-y-2">
                {#each useCase.metrics || [] as metric}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <span class="text-blue-500 mt-1">•</span>
                    <span>{metric}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- Prochaines étapes -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-purple-100 text-purple-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                </svg>
                Prochaines étapes
              </h3>
            </div>
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Prochaines étapes (une par ligne)</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Étape 1&#10;Étape 2&#10;..."
                  bind:value={draft.nextStepsText}
                  rows="3"
                ></textarea>
              </div>
            {:else}
              <ul class="space-y-2">
                {#each useCase.nextSteps || [] as step}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <span class="text-purple-500 mt-1">•</span>
                    <span>{step}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>

        <!-- COLONNE 3 -->
        <div class="space-y-6">
          <!-- Sources -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                </svg>
                Sources
              </h3>
            </div>
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Sources (une par ligne)</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Source 1&#10;Source 2&#10;..."
                  bind:value={draft.sourcesText}
                  rows="3"
                ></textarea>
              </div>
            {:else}
              <ul class="space-y-2">
                {#each useCase.sources || [] as source}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <svg class="w-4 h-4 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    <span>{source}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- Données liées -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path>
                </svg>
                Données associées
              </h3>
            </div>
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Données liées (une par ligne)</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Donnée 1&#10;Donnée 2&#10;..."
                  bind:value={draft.relatedDataText}
                  rows="3"
                ></textarea>
              </div>
            {:else}
              <ul class="space-y-2">
                {#each useCase.relatedData || [] as data}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <svg class="w-4 h-4 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path>
                    </svg>
                    <span>{data}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

        </div>
      </div>

      <!-- Références sur 3/3 colonnes -->
      {#if !isEditing && ((useCase.sources && useCase.sources.length > 0) || (useCase.references && useCase.references.length > 0))}
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold flex items-center gap-2">
              <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
              </svg>
              Références
            </h3>
          </div>
          <References sources={useCase.sources || []} references={useCase.references || []} />
        </div>
      {/if}

      <!-- Matrice détaillée en 2 colonnes séparées -->
      {#if matrix && useCase.valueScores && useCase.complexityScores && !isEditing}
        <div class="grid gap-6 md:grid-cols-2">
          <!-- Axes de Valeur -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Axes de Valeur
              </h3>
            </div>
            <div class="space-y-4">
              {#each matrix.valueAxes as axis}
                {@const score = useCase.valueScores.find(s => s.axisId === axis.id)}
                {#if score}
                  {@const stars = scoreToStars(Number(score.rating))}
                  <div class="rounded border border-slate-200 bg-white p-3">
                    <div class="flex items-center justify-between mb-2">
                      <h5 class="font-medium text-slate-900">{axis.name}</h5>
                      <div class="flex items-center gap-2">
                        <div class="flex items-center gap-1">
                          {#each Array(5) as _, i}
                            <svg class="w-4 h-4 {i < stars ? 'text-yellow-400' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                            </svg>
                          {/each}
                        </div>
                        <span class="text-sm text-slate-600">({score.rating} pts)</span>
                      </div>
                    </div>
                    <p class="text-sm text-slate-600">{score.description}</p>
                  </div>
                {/if}
              {/each}
            </div>
          </div>

          <!-- Axes de Complexité -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                </svg>
                Axes de Complexité
              </h3>
            </div>
            <div class="space-y-4">
              {#each matrix.complexityAxes as axis}
                {@const score = useCase.complexityScores.find(s => s.axisId === axis.id)}
                {#if score}
                  {@const stars = scoreToStars(Number(score.rating))}
                  <div class="rounded border border-slate-200 bg-white p-3">
                    <div class="flex items-center justify-between mb-2">
                      <h5 class="font-medium text-slate-900">{axis.name}</h5>
                      <div class="flex items-center gap-2">
                        <div class="flex items-center gap-1">
                          {#each Array(5) as _, i}
                            {#if i < stars}
                              <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                              </svg>
                            {:else}
                              <svg class="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                              </svg>
                            {/if}
                          {/each}
                        </div>
                        <span class="text-sm text-slate-600">({score.rating} pts)</span>
                      </div>
                    </div>
                    <p class="text-sm text-slate-600">{score.description}</p>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>