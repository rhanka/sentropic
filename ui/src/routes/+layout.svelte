<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import '../app.css';
  import Header from '$lib/components/Header.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import NavigationGuard from '$lib/components/NavigationGuard.svelte';
  import QueueMonitor from '$lib/components/QueueMonitor.svelte';
  import '$lib/i18n';
  import { initializeSession } from '$lib/stores/session';

  const AUTH_ROUTES = ['/auth/login', '/auth/register', '/auth/devices', '/auth/magic-link'];

  $: hideHeader = AUTH_ROUTES.some((route) => {
    const path = $page.url.pathname;
    return path === route || path.startsWith(`${route}/`);
  });

  // Initialize session on app mount
  onMount(() => {
    initializeSession();
  });
</script>

<svelte:head>
  <title>Top AI Ideas</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
  {#if !hideHeader}
    <Header />
  {/if}
  <main class="mx-auto max-w-7xl px-4 py-8">
    <slot />
  </main>
  <Toast />
  <NavigationGuard />
  <QueueMonitor />
</div>
