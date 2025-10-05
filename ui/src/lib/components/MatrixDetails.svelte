<script lang="ts">
  import StarRating from './StarRating.svelte';
  import type { MatrixConfig } from '../../types/matrix';
  import type { ScoreEntry } from '../utils/scoring';
  import { scoreToStars } from '../utils/scoring';
  
  export let matrix: MatrixConfig;
  export let valueScores: ScoreEntry[];
  export let complexityScores: ScoreEntry[];
  
  function getAxisScore(axisId: string, scores: ScoreEntry[]): ScoreEntry | null {
    return scores.find(s => s.axisId === axisId) || null;
  }
  
  function getAxisDescription(axis: any, rating: number): string {
    const levelDesc = axis.levelDescriptions.find((ld: any) => ld.level === rating);
    return levelDesc ? levelDesc.description : '';
  }
</script>

<div class="space-y-6">
  <h3 class="text-lg font-semibold text-slate-900">Évaluation Matrice</h3>
  
  <div class="grid gap-6 md:grid-cols-2">
    <!-- Axes de Valeur -->
    <div class="space-y-4">
      <h4 class="font-medium text-slate-800">Axes de Valeur</h4>
      {#each matrix.valueAxes as axis}
        {@const score = getAxisScore(axis.id, valueScores)}
        {#if score}
          {@const stars = scoreToStars(score.rating)}
          {@const description = getAxisDescription(axis, score.rating)}
          
          <div class="rounded border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between mb-2">
              <h5 class="font-medium text-slate-900">{axis.name}</h5>
              <div class="flex items-center gap-2">
                <StarRating filled={stars} empty={5 - stars} type="stars" size="sm" />
                <span class="text-sm text-slate-600">({score.rating} pts)</span>
              </div>
            </div>
            <p class="text-sm text-slate-600">{description}</p>
          </div>
        {/if}
      {/each}
    </div>
    
    <!-- Axes de Complexité -->
    <div class="space-y-4">
      <h4 class="font-medium text-slate-800">Axes de Complexité</h4>
      {#each matrix.complexityAxes as axis}
        {@const score = getAxisScore(axis.id, complexityScores)}
        {#if score}
          {@const stars = scoreToStars(score.rating)}
          {@const description = getAxisDescription(axis, score.rating)}
          
          <div class="rounded border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between mb-2">
              <h5 class="font-medium text-slate-900">{axis.name}</h5>
              <div class="flex items-center gap-2">
                <StarRating filled={stars} empty={5 - stars} type="x" size="sm" />
                <span class="text-sm text-slate-600">({score.rating} pts)</span>
              </div>
            </div>
            <p class="text-sm text-slate-600">{description}</p>
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>
