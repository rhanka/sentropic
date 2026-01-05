<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { currentFolderId } from '$lib/stores/folders';

  onMount(() => {
    // Page liste déplacée vers /dossiers/[id]
    const urlParams = new URLSearchParams($page.url.search);
    const folderId = urlParams.get('folder');
    if (folderId) {
      currentFolderId.set(folderId);
      goto(`/dossiers/${folderId}`, { replaceState: true });
      return;
    }
    if ($currentFolderId) {
      goto(`/dossiers/${$currentFolderId}`, { replaceState: true });
      return;
    }
    goto('/dossiers', { replaceState: true });
  });
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Redirection…</h1>
</section>
