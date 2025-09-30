<script lang="ts">
  import { matrixStore } from '$lib/stores/matrix';

  const addAxis = (type: 'valueAxes' | 'complexityAxes') => {
    matrixStore.update((matrix) => ({
      ...matrix,
      [type]: [
        ...matrix[type],
        { id: crypto.randomUUID(), name: 'Nouvel axe', weight: 1 }
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
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Configuration de la matrice</h1>
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
