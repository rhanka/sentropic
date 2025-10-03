<script lang="ts">
  import { matrixStore } from '$lib/stores/matrix';
  import { currentFolderId } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { onMount } from 'svelte';

  let isLoading = false;

  onMount(async () => {
    await loadMatrix();
  });

  const loadMatrix = async () => {
    if (!$currentFolderId) {
      addToast({
        type: 'info',
        message: 'Veuillez sélectionner un dossier pour voir sa matrice'
      });
      return;
    }

    isLoading = true;
    try {
      const response = await fetch(`http://localhost:8787/api/v1/folders/${$currentFolderId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch folder');
      }
      const folder = await response.json();
      
      if (folder.matrixConfig) {
        const matrix = typeof folder.matrixConfig === 'string' 
          ? JSON.parse(folder.matrixConfig) 
          : folder.matrixConfig;
        matrixStore.set(matrix);
        addToast({
          type: 'success',
          message: `Matrice du dossier "${folder.name}" chargée`
        });
      } else {
        addToast({
          type: 'warning',
          message: `Le dossier "${folder.name}" n'a pas de matrice configurée`
        });
      }
    } catch (error) {
      console.error('Failed to load matrix:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement de la matrice'
      });
    } finally {
      isLoading = false;
    }
  };

  const addAxis = (type: 'valueAxes' | 'complexityAxes') => {
    matrixStore.update((matrix) => ({
      ...matrix,
      [type]: [
        ...matrix[type],
        { name: 'Nouvel axe', weight: 1 }
      ]
    }));
  };

  const addThreshold = (type: 'valueThresholds' | 'complexityThresholds') => {
    matrixStore.update((matrix) => ({
      ...matrix,
      [type]: [
        ...matrix[type],
        { level: matrix[type].length + 1, points: 10, threshold: 10 }
      ]
    }));
  };

  const saveMatrix = async () => {
    if (!$currentFolderId) return;

    try {
      const response = await fetch(`http://localhost:8787/api/v1/folders/${$currentFolderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matrixConfig: JSON.stringify($matrixStore)
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save matrix');
      }

      addToast({
        type: 'success',
        message: 'Matrice sauvegardée avec succès !'
      });
    } catch (error) {
      console.error('Failed to save matrix:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde de la matrice'
      });
    }
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Configuration de la matrice</h1>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={saveMatrix}>
      Sauvegarder
    </button>
  </div>

  {#if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">Chargement de la matrice...</p>
    </div>
  {/if}

  {#if !$currentFolderId}
    <div class="rounded border border-amber-200 bg-amber-50 p-4">
      <p class="text-sm text-amber-700">Veuillez sélectionner ou créer un dossier pour configurer sa matrice.</p>
    </div>
  {/if}

  <div class="grid gap-6 md:grid-cols-2">
    <section class="rounded border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium">Axes de valeur</h2>
        <button class="text-sm text-primary" on:click={() => addAxis('valueAxes')}>
          Ajouter un axe
        </button>
      </div>
      <ul class="mt-3 space-y-2 text-sm text-slate-600">
        {#each $matrixStore.valueAxes as axis}
          <li class="flex items-center justify-between rounded border border-slate-200 p-2">
            <span>{axis.name}</span>
            <span>Poids: {axis.weight}</span>
          </li>
        {/each}
      </ul>
    </section>
    <section class="rounded border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium">Axes de complexité</h2>
        <button class="text-sm text-primary" on:click={() => addAxis('complexityAxes')}>
          Ajouter un axe
        </button>
      </div>
      <ul class="mt-3 space-y-2 text-sm text-slate-600">
        {#each $matrixStore.complexityAxes as axis}
          <li class="flex items-center justify-between rounded border border-slate-200 p-2">
            <span>{axis.name}</span>
            <span>Poids: {axis.weight}</span>
          </li>
        {/each}
      </ul>
    </section>
  </div>
  <div class="grid gap-6 md:grid-cols-2">
    <section class="rounded border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium">Seuils valeur</h2>
        <button class="text-sm text-primary" on:click={() => addThreshold('valueThresholds')}>
          Ajouter un seuil
        </button>
      </div>
      <ul class="mt-3 space-y-2 text-sm text-slate-600">
        {#each $matrixStore.valueThresholds as threshold}
          <li class="flex items-center justify-between rounded border border-slate-200 p-2">
            <span>Niveau {threshold.level}</span>
            <span>Points: {threshold.points} – Seuil: {threshold.threshold}</span>
          </li>
        {/each}
      </ul>
    </section>
    <section class="rounded border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium">Seuils complexité</h2>
        <button class="text-sm text-primary" on:click={() => addThreshold('complexityThresholds')}>
          Ajouter un seuil
        </button>
      </div>
      <ul class="mt-3 space-y-2 text-sm text-slate-600">
        {#each $matrixStore.complexityThresholds as threshold}
          <li class="flex items-center justify-between rounded border border-slate-200 p-2">
            <span>Niveau {threshold.level}</span>
            <span>Points: {threshold.points} – Seuil: {threshold.threshold}</span>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</section>
