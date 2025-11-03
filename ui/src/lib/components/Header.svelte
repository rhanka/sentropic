<script lang="ts">
  import { derived } from 'svelte/store';
  import { page } from '$app/stores';
  import { _, locale } from 'svelte-i18n';
  import { session, isAuthenticated, logout, retrySessionInit } from '../stores/session';
  import { setLocale } from '../i18n';
  import { currentFolderId } from '../stores/folders';
  import { useCasesStore } from '../stores/useCases';

  let showUserMenu = false;

  const navItems = [
    { href: '/', label: 'nav.home' },
    { href: '/dossiers', label: 'nav.folders' },
    { href: '/entreprises', label: 'nav.companies' },
    { href: '/cas-usage', label: 'nav.useCases' },
    { href: '/matrice', label: 'nav.matrix' },
    { href: '/dashboard', label: 'nav.dashboard' },
    { href: '/parametres', label: 'nav.settings' }
  ];

  const currentPath = derived(page, ($page) => $page.url.pathname);

  // Logique pour déterminer si les menus doivent être grisés
  const isMenuDisabled = (href: string) => {
    // Si l'utilisateur n'est pas authentifié, griser tous les menus sauf l'accueil (/)
    if (!$isAuthenticated) {
      return href !== '/';
    }
    
    // Si aucun dossier n'est sélectionné, griser cas-usage et dashboard
    if (!$currentFolderId) {
      return href === '/cas-usage' || href === '/dashboard';
    }
    
    // Si un dossier est sélectionné mais n'a pas de cas d'usage, griser cas-usage et dashboard
    const currentFolderUseCases = $useCasesStore.filter(uc => uc.folderId === $currentFolderId);
    if (currentFolderUseCases.length === 0) {
      return href === '/cas-usage' || href === '/dashboard';
    }
    
    return false;
  };

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
  <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
    <nav class="flex flex-1 flex-wrap items-center gap-4 text-sm font-medium">
      {#each navItems as item}
        {@const isDisabled = isMenuDisabled(item.href)}
        <a
          href={isDisabled ? '#' : item.href}
          class:active-link={$currentPath === item.href}
          class="rounded px-2 py-1 transition {isDisabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100'}"
          on:click={isDisabled ? (e) => e.preventDefault() : undefined}
          >{translate(item.label)}</a
        >
      {/each}
    </nav>
    <div class="flex items-center gap-3">
      <select class="rounded border border-slate-200 px-2 py-1 text-sm" on:change={onLocaleChange}>
        <option value="fr">FR</option>
        <option value="en">EN</option>
      </select>
      {#if $isAuthenticated && $session.user}
        <div class="relative">
          <button
            on:click={() => showUserMenu = !showUserMenu}
            class="flex items-center gap-2 rounded px-3 py-1 text-sm hover:bg-slate-100 transition"
          >
            <div class="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-medium">
              {($session.user.displayName || $session.user.email || 'U')[0].toUpperCase()}
            </div>
            <span class="text-slate-700">{$session.user.displayName || $session.user.email || 'User'}</span>
            <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if showUserMenu}
            <div class="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 border border-slate-200 z-50">
              {#if $session.user?.id === 'unknown'}
                <button
                  on:click={() => { showUserMenu = false; retrySessionInit(); }}
                  class="block w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50"
                >
                  🔄 Actualiser les informations
                </button>
                <div class="border-t border-slate-200 my-1"></div>
              {/if}
              <a
                href="/auth/devices"
                class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                on:click={() => showUserMenu = false}
              >
                Mes appareils
              </a>
              <a
                href="/parametres"
                class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                on:click={() => showUserMenu = false}
              >
                Paramètres
              </a>
              <div class="border-t border-slate-200 my-1"></div>
              <button
                on:click={() => { showUserMenu = false; logout(); }}
                class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                Déconnexion
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <a href="/auth/login" class="rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700 transition">
          Connexion
        </a>
      {/if}
    </div>
  </div>
</header>

<!-- Click outside to close user menu -->
{#if showUserMenu}
  <button
    class="fixed inset-0 z-40"
    on:click={() => showUserMenu = false}
    aria-label="Close menu"
  ></button>
{/if}

<style>
  :global(.active-link) {
    background-color: rgb(226 232 240);
    color: rgb(15 23 42);
  }
</style>
