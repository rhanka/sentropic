<script lang="ts">
  export let references: Array<{title: string; url: string}> = [];
  
  let clickedRefs = new Set<number>();
  
  function handleRefClick(index: number, url: string, event: MouseEvent) {
    if (clickedRefs.has(index)) {
      // Deuxième clic : ouvrir l'URL
      event.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
      clickedRefs.delete(index); // Réinitialiser après ouverture
    } else {
      // Premier clic : marquer comme cliqué, empêcher la navigation par défaut
      // Le scroll vers cette référence est géré par le lien [1], [2] dans la description
      // Ici on empêche juste la navigation directe, l'utilisateur doit cliquer une deuxième fois
      event.preventDefault();
      clickedRefs.add(index);
      // Réinitialiser après un délai pour permettre un nouveau cycle si pas de deuxième clic
      setTimeout(() => {
        clickedRefs.delete(index);
      }, 3000);
    }
  }
</script>

{#if (references && references.length > 0)}
  <div class="space-y-2">    
    <!-- Références (format objet) avec numérotation -->
    {#each references as ref, index}
      <div class="flex items-start gap-2 text-sm" id="ref-{index + 1}">
        <span class="text-slate-500 font-medium mt-0.5 flex-shrink-0">{index + 1}.</span>
        <svg class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
        </svg>
        <a 
          href={ref.url} 
          target="_blank" 
          rel="noopener noreferrer"
          class="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
          on:click={(e) => handleRefClick(index, ref.url, e)}
        >
          {ref.title}
        </a>
      </div>
    {/each}
  </div>
{/if}
