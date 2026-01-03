<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // La création de dossier et la génération sont désormais sur /dossier/new.
  onMount(() => {
    goto('/dossier/new', { replaceState: true });
  });
</script>

<section class="space-y-6">
  <div class="rounded border border-slate-200 bg-white p-6 shadow-sm">
    Redirection vers <a class="underline text-blue-600" href="/dossier/new">/dossier/new</a>…
  </div>
</section>
