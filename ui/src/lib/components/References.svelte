<script lang="ts">
  export let references: Array<{title: string; url: string}> = [];
  
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

{#if (references && references.length > 0)}
  <div class="space-y-2">    
    <!-- Références (format objet) -->
    {#each references as ref}
      <div class="flex items-start gap-2 text-sm">
        <svg class="w-4 h-4 text-green-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
        </svg>
        <a 
          href={ref.url} 
          target="_blank" 
          rel="noopener noreferrer"
          class="text-blue-600 hover:text-blue-800 hover:underline"
        >
          {ref.title}
        </a>
      </div>
    {/each}
  </div>
{/if}
