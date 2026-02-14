<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { currentFolderId } from '$lib/stores/folders';
  import { _ } from 'svelte-i18n';

  onMount(() => {
    // Use case list moved to /folders/[id]
    const urlParams = new URLSearchParams($page.url.search);
    const folderId = urlParams.get('folder');
    if (folderId) {
      currentFolderId.set(folderId);
      goto(`/folders/${folderId}`, { replaceState: true });
      return;
    }
    if ($currentFolderId) {
      goto(`/folders/${$currentFolderId}`, { replaceState: true });
      return;
    }
    goto('/folders', { replaceState: true });
  });
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">{$_('common.redirecting')}</h1>
</section>
