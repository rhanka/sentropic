<script lang="ts">
  import StarRating from './StarRating.svelte';
  
  export let title: string;
  export let score: number;
  export let stars: number;
  export let type: 'value' | 'complexity' = 'value';
  
  $: starDisplay = { filled: stars, empty: 5 - stars };
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
  <h3 class="font-semibold text-slate-900 mb-2">{title}</h3>
  <div class="flex items-center gap-3">
    <StarRating 
      filled={starDisplay.filled} 
      empty={starDisplay.empty} 
      type={type === 'value' ? 'stars' : 'x'}
      size="lg"
    />
    <span class="text-lg font-bold {type === 'value' ? 'text-green-600' : 'text-orange-600'}">
      ({score.toFixed(1)} points)
    </span>
  </div>
</div>
