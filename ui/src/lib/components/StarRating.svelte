<script lang="ts">
  import { Star, X } from '@lucide/svelte';
  
  export let filled: number = 0;
  export let empty: number = 0;
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let type: 'stars' | 'x' = 'stars';
  
  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4', 
    lg: 'w-5 h-5'
  };

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
</script>

<div class="flex items-center gap-1">
  {#each range(filled) as i (i)}
    {#if type === 'stars'}
      <Star class="{sizeClasses[size]} text-yellow-400 fill-yellow-400" />
    {:else}
      <X class="{sizeClasses[size]} text-gray-800" />
    {/if}
  {/each}
  
  {#each range(empty) as i (i)}
    {#if type === 'stars'}
      <Star class="{sizeClasses[size]} text-gray-300" />
    {:else}
      <X class="{sizeClasses[size]} text-gray-300" />
    {/if}
  {/each}
</div>
