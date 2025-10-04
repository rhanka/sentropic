<script lang="ts">
  import '../app.css';
  import Header from '$lib/components/Header.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import NavigationGuard from '$lib/components/NavigationGuard.svelte';
  import '$lib/i18n';
</script>

<svelte:head>
  <title>Top AI Ideas</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
  <Header />
  <main class="mx-auto max-w-7xl px-4 py-8">
    <slot />
  </main>
  <Toast />
  <NavigationGuard />
</div>
