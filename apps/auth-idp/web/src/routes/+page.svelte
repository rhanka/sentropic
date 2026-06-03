<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  // Root of the IdP screens front: nothing to show here, send the user to login.
  onMount(() => {
    void goto('/auth/login');
  });
</script>

<div class="flex items-center justify-center py-20 text-sm text-slate-500">Redirecting…</div>
