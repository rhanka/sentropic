<script lang="ts">
  import { page } from '$app/stores';
  import { derived } from 'svelte/store';
  import { useCasesStore } from '$lib/stores/useCases';

  const useCase = derived([useCasesStore, page], ([$useCases, $page]) =>
    $useCases.find((item) => item.id === $page.params.id)
  );
</script>

{#if $useCase}
  <article class="space-y-6">
    <div>
      <h1 class="text-3xl font-semibold">{$useCase.name}</h1>
      {#if $useCase.description}
        <p class="mt-2 text-slate-600">{$useCase.description}</p>
      {/if}
    </div>
    <div class="grid gap-6 md:grid-cols-2">
      <section class="rounded border border-slate-200 bg-white p-4">
        <h2 class="text-lg font-medium">Bénéfices</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-600">
          {#each $useCase.benefits as benefit}
            <li>• {benefit}</li>
          {/each}
        </ul>
      </section>
      <section class="rounded border border-slate-200 bg-white p-4">
        <h2 class="text-lg font-medium">Prochaines étapes</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-600">
          {#each $useCase.nextSteps as step}
            <li>• {step}</li>
          {/each}
        </ul>
      </section>
    </div>
    <section class="rounded border border-slate-200 bg-white p-4">
      <h2 class="text-lg font-medium">Scores</h2>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 class="text-sm font-semibold text-slate-500">Valeur</h3>
          <ul class="mt-2 space-y-1 text-sm text-slate-600">
            {#each $useCase.valueScores as score}
              <li>{score.axisId}: {score.rating}/5</li>
            {/each}
          </ul>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-slate-500">Complexité</h3>
          <ul class="mt-2 space-y-1 text-sm text-slate-600">
            {#each $useCase.complexityScores as score}
              <li>{score.axisId}: {score.rating}/5</li>
            {/each}
          </ul>
        </div>
      </div>
    </section>
  </article>
{:else}
  <p>Cas d'usage introuvable.</p>
{/if}
