<script lang="ts">
  import { BaseEdge } from '@xyflow/svelte';
  let { id, data, style, markerEnd } = $props();
  let path = $derived(data.waypoints.map((point: { x: number; y: number }, index: number) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '));
</script>
<BaseEdge {id} {path} {style} {markerEnd} />
