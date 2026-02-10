<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';

  // Folder creation and generation are now on /folder/new.
  onMount(() => {
    goto('/folder/new', { replaceState: true });
  });
</script>

<section class="space-y-6">
  <div class="rounded border border-slate-200 bg-white p-6 shadow-sm">
    {$_('home.redirectingTo', { values: { path: '/folder/new' } })}
  </div>
</section>
