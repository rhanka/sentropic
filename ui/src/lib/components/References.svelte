<script lang="ts">
  export let sources: string[] = [];
  
  function parseMarkdownLink(text: string): { title: string; url: string } | null {
    const match = text.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (match) {
      return {
        title: match[1],
        url: match[2]
      };
    }
    return null;
  }
</script>

{#if sources && sources.length > 0}
  <div class="space-y-4">
    <h3 class="text-lg font-semibold text-slate-900">Références</h3>
    <div class="space-y-2">
      {#each sources as source}
        {@const link = parseMarkdownLink(source)}
        {#if link}
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
            <a 
              href={link.url} 
              target="_blank" 
              rel="noopener noreferrer"
              class="text-blue-600 hover:text-blue-800 hover:underline"
            >
              {link.title}
            </a>
          </div>
        {:else}
          <div class="text-slate-600">{source}</div>
        {/if}
      {/each}
    </div>
  </div>
{/if}
