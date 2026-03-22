<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';

  // Home now redirects to neutral workspace landing (default dashboard).
  onMount(() => {
    goto('/neutral', { replaceState: true });
  });
</script>

<section class="space-y-6">
  <div class="rounded border border-slate-200 bg-white p-6 shadow-sm">
    {$_('home.redirectingTo', { values: { path: '/neutral' } })}
  </div>
</section>
