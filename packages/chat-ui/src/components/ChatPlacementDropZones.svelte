<script lang="ts">
  import { placementId, type ChatPlacement } from '../state/chatPlacement.js';
  import type { DropZone } from '../state/chatPlacementDnd.js';

  export let zones: DropZone[] = [];
  export let hovered: ChatPlacement | null = null;
  export let labelForPlacement: (placement: ChatPlacement) => string;
</script>

<div data-chat-placement-drop-zones class="fixed inset-0 z-[60] pointer-events-none" aria-hidden="true">
  <!--
    A placement may own SEVERAL rects (the floating columns cover both the
    central block and the bottom strip), so the key must include the index —
    keying on the placement alone duplicates keys and Svelte then renders
    nothing at all.
  -->
  {#each zones as zone, i (`${placementId(zone.placement)}#${i}`)}
    {@const isHovered = hovered && placementId(hovered) === placementId(zone.placement)}
    <div
      class={isHovered
        ? 'absolute flex items-center justify-center border-2 border-primary bg-primary/20 text-primary text-sm font-medium transition-colors motion-reduce:transition-none'
        : 'absolute flex items-center justify-center border-2 border-primary/50 bg-white/80 text-slate-700 text-sm font-medium transition-colors motion-reduce:transition-none'}
      style={`left: ${zone.rect.x}px; top: ${zone.rect.y}px; width: ${zone.rect.width}px; height: ${zone.rect.height}px;`}
    >
      {labelForPlacement(zone.placement)}
    </div>
  {/each}
</div>
