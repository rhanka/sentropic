<script lang="ts">
  import { derived } from 'svelte/store';
  import { page } from '$app/stores';
  import { _, locale } from 'svelte-i18n';
  import { userStore } from '../stores/auth';
  import { setLocale } from '../i18n';

  const navItems = [
    { href: '/', label: 'nav.home' },
    { href: '/dossiers', label: 'nav.folders' },
    { href: '/entreprises', label: 'nav.companies' },
    { href: '/configuration-metier', label: 'nav.business' },
    { href: '/cas-usage', label: 'nav.useCases' },
    { href: '/matrice', label: 'nav.matrix' },
    { href: '/dashboard', label: 'nav.dashboard' },
    { href: '/design', label: 'nav.design' },
    { href: '/donnees', label: 'nav.data' },
    { href: '/parametres', label: 'nav.settings' },
    { href: '/admin', label: 'Administration' }
  ];

  const currentPath = derived(page, ($page) => $page.url.pathname);

  const onLocaleChange = (event: Event) => {
    const target = event.target as HTMLSelectElement;
    setLocale(target.value);
  };

  // Fonction pour traduire avec fallback
  const translate = (key: string) => {
    try {
      return $_(key);
    } catch (error) {
      // Fallback si i18n n'est pas encore initialisé
      return key;
    }
  };
</script>

<header class="border-b border-slate-200 bg-white">
  <div class="mx-auto flex max-w-8xl items-center justify-between px-4 py-3">
    <nav class="flex flex-1 flex-wrap items-center gap-4 text-sm font-medium">
      {#each navItems as item}
        <a
          href={item.href}
          class:active-link={$currentPath === item.href}
          class="rounded px-2 py-1 text-slate-600 transition hover:bg-slate-100"
          >{translate(item.label)}</a
        >
      {/each}
    </nav>
    <div class="flex items-center gap-3">
      <select class="rounded border border-slate-200 px-2 py-1 text-sm" on:change={onLocaleChange}>
        <option value="fr">FR</option>
        <option value="en">EN</option>
      </select>
      {#if $userStore}
        <div class="flex items-center gap-2">
          {#if $userStore.avatarUrl}
            <img
              src={$userStore.avatarUrl}
              alt="avatar"
              class="h-8 w-8 rounded-full border border-slate-200"
            />
          {/if}
          <span class="text-sm text-slate-600">{$userStore.name}</span>
        </div>
      {:else}
        <button class="rounded bg-primary px-3 py-1 text-sm text-white">Connexion</button>
      {/if}
    </div>
  </div>
</header>

<style>
  :global(.active-link) {
    background-color: rgb(226 232 240);
    color: rgb(15 23 42);
  }
</style>
