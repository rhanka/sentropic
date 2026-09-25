<script lang="ts">
  import { getContext, onMount } from 'svelte';
  export let sessions = [], sessionId = null, draft = '', loadingSessions = false, contextStore = {};
  const lifecycle = getContext<{ mount: () => void; destroy: () => void }>('composer-lifecycle');
  onMount(() => { lifecycle.mount(); return lifecycle.destroy; });
</script>
<textarea aria-label="Composer" bind:value={draft}></textarea>
