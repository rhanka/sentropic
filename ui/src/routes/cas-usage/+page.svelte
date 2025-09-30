<script lang="ts">
  import { useCasesStore } from '$lib/stores/useCases';
  import { onMount } from 'svelte';

  onMount(() => {
    useCasesStore.set([
      {
        id: 'uc1',
        folderId: 'f1',
        name: 'Assistant IA pour le support',
        description: 'Automatiser les réponses de premier niveau',
        benefits: ['Réduction temps de réponse', 'Amélioration satisfaction'],
        metrics: ['NPS', 'Temps de traitement'],
        risks: ['Biais IA'],
        nextSteps: ['Valider périmètre', 'Collecter données'],
        sources: ['FAQ', 'CRM'],
        relatedData: ['Tickets support'],
        valueScores: [],
        complexityScores: [],
        totalValueScore: 75,
        totalComplexityScore: 40
      }
    ]);
  });
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Cas d'usage</h1>
  <div class="grid gap-4 md:grid-cols-2">
    {#each $useCasesStore as useCase}
      <article class="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="text-xl font-medium">{useCase.name}</h2>
        {#if useCase.description}
          <p class="mt-2 text-sm text-slate-600">{useCase.description}</p>
        {/if}
        <div class="mt-4 flex gap-4 text-sm text-slate-500">
          <span>Valeur: {useCase.totalValueScore ?? 'N/A'}</span>
          <span>Complexité: {useCase.totalComplexityScore ?? 'N/A'}</span>
        </div>
        <a class="mt-4 inline-flex text-sm text-primary" href={`/cas-usage/${useCase.id}`}>
          Voir le détail
        </a>
      </article>
    {/each}
  </div>
</section>
