<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} usage routed through renderMarkdownWithRefs(), which sanitises via DOMPurify.
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { scoreToStars } from '$lib/utils/scoring';
  import { Star, X, Minus } from '@lucide/svelte';
  import { renderMarkdownWithRefs } from '$lib/utils/markdown';

  export let axes: Array<{ id: string; name: string }> = [];
  export let scores: Array<{ axisId: string; rating: number; description?: string }> = [];
  export let displayMode: 'stars' | 'xminus' = 'stars';
  export let locked: boolean = false;
  export let apiEndpoint: string = '';
  export let scorePrefix: string = 'value';
  export let entityId: string = '';
  export let scoreBuffers: Record<string, string> = {};
  export let scoreOriginals: Record<string, string> = {};
  export let references: Array<{ title: string; url: string; excerpt?: string }> = [];
  export let onScoreChange: ((key: string, value: string) => void) | null = null;
  export let onScoreSaved: (() => void) | null = null;
  export let isPrinting: boolean = false;
  export let getScoreFullData: ((axisId: string) => Record<string, unknown> | null) | null = null;

  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const getScoreForAxis = (axisId: string) =>
    scores.find((s) => s.axisId === axisId);

  const getBufferValue = (axisId: string): string => {
    const key = `${scorePrefix}-${axisId}`;
    if (scoreBuffers[key] !== undefined) return scoreBuffers[key];
    const score = getScoreForAxis(axisId);
    return score?.description || '';
  };

  const getParsedDescription = (axisId: string): string => {
    const bufferValue = getBufferValue(axisId);
    return renderMarkdownWithRefs(bufferValue, references, { addListStyles: true, listPadding: 1.5 });
  };
</script>

<div class="space-y-4">
  {#each axes as axis}
    {@const score = getScoreForAxis(axis.id)}
    {#if score}
      {@const stars = scoreToStars(Number(score.rating))}
      {@const key = `${scorePrefix}-${axis.id}`}
      {@const bufferValue = getBufferValue(axis.id)}
      <div class="rounded border border-slate-200 bg-white p-3">
        <div class="flex items-center justify-between mb-2">
          <h5 class="font-medium text-slate-900">{axis.name}</h5>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1">
              {#each range(5) as i (i)}
                {#if displayMode === 'stars'}
                  <Star class="w-4 h-4 {i < stars ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}" />
                {:else}
                  {#if i < stars}
                    <X class="w-4 h-4 text-red-500" />
                  {:else}
                    <Minus class="w-4 h-4 text-gray-300" />
                  {/if}
                {/if}
              {/each}
            </div>
            <span class="text-sm text-slate-600">({score.rating} pts)</span>
          </div>
        </div>
        {#if isPrinting}
          <p class="text-sm text-slate-600">{@html getParsedDescription(axis.id)}</p>
        {:else}
          <div class="text-sm text-slate-600 leading-relaxed prose prose-sm max-w-none">
            <EditableInput
              {locked}
              label=""
              value={bufferValue}
              markdown={true}
              apiEndpoint={apiEndpoint}
              fullData={getScoreFullData ? getScoreFullData(axis.id) : null}
              fullDataGetter={getScoreFullData ? (() => getScoreFullData(axis.id)) : undefined}
              changeId={entityId ? `${entityId}-${scorePrefix}Score-${axis.id}` : ''}
              originalValue={scoreOriginals[key] || ''}
              {references}
              on:change={(e) => { if (onScoreChange) onScoreChange(key, e.detail.value); }}
              on:saved={() => { if (onScoreSaved) onScoreSaved(); }}
            />
          </div>
        {/if}
      </div>
    {/if}
  {/each}
</div>
