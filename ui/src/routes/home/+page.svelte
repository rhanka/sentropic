<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // La création de dossier et la génération sont désormais sur /folder/new.
  onMount(() => {
    goto('/folder/new', { replaceState: true });
  });
</script>

<section class="space-y-6">
  <div class="rounded border border-slate-200 bg-white p-6 shadow-sm">
    Redirection vers <a class="underline text-blue-600" href="/folder/new">/folder/new</a>…
  </div>
</section>
