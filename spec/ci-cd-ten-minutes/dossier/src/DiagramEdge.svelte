<script lang="ts">
  import { BaseEdge } from '@xyflow/svelte';
  import type { EdgeProps } from '@xyflow/svelte';
  let { id, data, style, markerEnd }: EdgeProps = $props();
  let path = $derived((data!.waypoints as { x: number; y: number }[]).map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '));
</script>
<BaseEdge {id} {path} {style} {markerEnd} />
