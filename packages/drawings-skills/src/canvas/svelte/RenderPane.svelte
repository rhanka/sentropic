<script lang="ts">
  import type { RendererPort } from '../types';

  // `host` is bindable so an overlay (AnnotationLayer) can anchor to the rendered SVG.
  let {
    renderer,
    source,
    host = $bindable<HTMLDivElement | null>(null),
  }: { renderer: RendererPort; source: string; host?: HTMLDivElement | null } = $props();

  let error = $state<string | null>(null);

  $effect(() => {
    const current = source; // track
    if (!host) return;
    let cancelled = false;
    void (async () => {
      const res = await renderer.render(current, host);
      if (cancelled) return;
      error = res.ok ? null : res.error;
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="relative h-full w-full overflow-auto bg-white">
  <div bind:this={host} class="flex h-full w-full items-center justify-center p-4"></div>
  {#if error}
    <div
      class="absolute inset-x-2 bottom-2 rounded border border-red-200 bg-red-50 p-2 font-mono text-xs text-red-700"
    >
      {error}
    </div>
  {/if}
</div>
