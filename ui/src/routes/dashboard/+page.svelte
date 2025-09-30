<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { useCasesStore } from '$lib/stores/useCases';

  let metrics = { total: 0, averageValue: 0, averageComplexity: 0 };

  onMount(() => {
    const useCases = get(useCasesStore);
    if (useCases.length) {
      const total = useCases.length;
      const value = useCases.reduce((acc, uc) => acc + (uc.totalValueScore ?? 0), 0);
      const complexity = useCases.reduce((acc, uc) => acc + (uc.totalComplexityScore ?? 0), 0);
      metrics = {
        total,
        averageValue: Math.round((value / total) * 100) / 100,
        averageComplexity: Math.round((complexity / total) * 100) / 100
      };
    }
  });
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Dashboard</h1>
  <div class="grid gap-4 md:grid-cols-3">
    <div class="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-sm text-slate-500">Nombre de cas</p>
      <p class="text-2xl font-semibold">{metrics.total}</p>
    </div>
    <div class="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-sm text-slate-500">Valeur moyenne</p>
      <p class="text-2xl font-semibold">{metrics.averageValue}</p>
    </div>
    <div class="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-sm text-slate-500">Complexité moyenne</p>
      <p class="text-2xl font-semibold">{metrics.averageComplexity}</p>
    </div>
  </div>
  <div class="rounded border border-dashed border-slate-300 p-8 text-center text-slate-500">
    Visualisation scatter à implémenter (dépendance graphique).
  </div>
</section>
