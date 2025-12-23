<script lang="ts">
  import { ExternalLink } from '@lucide/svelte';
  
  export let references: Array<{title: string; url: string}> = [];
  export let referencesScaleFactor: number = 1; // Facteur de réduction pour impression (> 10 refs)
  
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
  {@const scale = referencesScaleFactor < 1 ? referencesScaleFactor : 1}
  {@const lineHeight = scale < 1 ? scale * 1.5 : 1.5}
  {@const gap = scale < 1 ? scale * 0.5 : 0.5}
  <div 
    class="space-y-2 references-content" 
    style={scale < 1 ? `font-size: ${scale}em !important; line-height: ${lineHeight}em !important;` : ''}
  >    
    <!-- Références (format objet) avec numérotation -->
    {#each references as ref, index}
      <div 
        class="flex items-start gap-2 {scale < 1 ? '' : 'text-sm'}" 
        id="ref-{index + 1}"
        style={scale < 1 ? `gap: ${gap}rem; margin-bottom: ${gap}rem; font-size: inherit !important; line-height: inherit !important;` : ''}
      >
        <span 
          class="text-slate-500 font-medium mt-0.5 flex-shrink-0"
          style={scale < 1 ? `font-size: inherit !important; line-height: inherit !important;` : ''}
        >{index + 1}.</span>
        <ExternalLink 
          class="text-green-500 mt-0.5 flex-shrink-0" 
          style={scale < 1 ? `width: ${scale * 1}em !important; height: ${scale * 1}em !important;` : 'width: 1em; height: 1em;'}
        />
        <a 
          href={ref.url} 
          target="_blank" 
          rel="noopener noreferrer"
          class="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
          style={scale < 1 ? `font-size: inherit !important; line-height: inherit !important;` : ''}
          on:click={(e) => handleRefClick(index, ref.url, e)}
        >
          {ref.title}
        </a>
      </div>
    {/each}
  </div>
{/if}
