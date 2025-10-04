<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { useCasesStore } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';

  let useCase: any = undefined;
  let isEditing = false;
  let draft: any = {};
  let error = '';

  $: useCaseId = $page.params.id;

  onMount(async () => {
    await loadUseCase();
  });

  const loadUseCase = async () => {
    try {
      const useCases = $useCasesStore;
      useCase = useCases.find(uc => uc.id === useCaseId);
      if (useCase) {
        draft = { ...useCase };
      } else {
        addToast({ type: 'error', message: 'Cas d\'usage non trouvé' });
        error = 'Cas d\'usage non trouvé';
      }
    } catch (err) {
      console.error('Failed to fetch use case:', err);
      addToast({ type: 'error', message: 'Erreur lors du chargement du cas d\'usage' });
      error = 'Erreur lors du chargement du cas d\'usage';
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
</script>

<section class="space-y-6">
  {#if error}
    <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
      {error}
    </div>
  {/if}

  {#if useCase}
    <div class="space-y-6">
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
          {#if useCase.description || isEditing}
            <p class="text-lg text-slate-600 mt-1">
              {#if isEditing}
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea 
                    class="text-lg text-slate-600 bg-transparent border-b border-slate-300 outline-none w-full"
                    placeholder="Description du cas d'usage"
                    bind:value={draft.description}
                    rows="2"
                  ></textarea>
                </div>
              {:else}
                {useCase.description}
              {/if}
            </p>
          {/if}
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

      <!-- Scores -->
      <div class="grid gap-6 md:grid-cols-2">
        <div class="rounded border border-slate-200 bg-white p-4">
          <h3 class="font-semibold text-slate-900 mb-2">Score de Valeur</h3>
          <p class="text-2xl font-bold text-green-600">{useCase.totalValueScore ?? 'N/A'}</p>
        </div>
        <div class="rounded border border-slate-200 bg-white p-4">
          <h3 class="font-semibold text-slate-900 mb-2">Score de Complexité</h3>
          <p class="text-2xl font-bold text-orange-600">{useCase.totalComplexityScore ?? 'N/A'}</p>
        </div>
      </div>

      <!-- Bénéfices -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Bénéfices</h3>
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
          <ul class="list-disc list-inside text-slate-600">
            {#each useCase.benefits || [] as benefit}
              <li>{benefit}</li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Métriques -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Métriques</h3>
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
          <ul class="list-disc list-inside text-slate-600">
            {#each useCase.metrics || [] as metric}
              <li>{metric}</li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Risques -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Risques</h3>
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
          <ul class="list-disc list-inside text-slate-600">
            {#each useCase.risks || [] as risk}
              <li>{risk}</li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Prochaines étapes -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Prochaines étapes</h3>
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
          <ul class="list-disc list-inside text-slate-600">
            {#each useCase.nextSteps || [] as step}
              <li>{step}</li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Sources -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Sources</h3>
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
          <ul class="list-disc list-inside text-slate-600">
            {#each useCase.sources || [] as source}
              <li>{source}</li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Données liées -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Données liées</h3>
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
          <ul class="list-disc list-inside text-slate-600">
            {#each useCase.relatedData || [] as data}
              <li>{data}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</section>