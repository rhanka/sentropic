<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { derived } from 'svelte/store';
  import { page } from '$app/stores';
  import { _, locale as i18nLocale } from 'svelte-i18n';
  import { session, isAuthenticated, logout, retrySessionInit } from '../stores/session';
  import { setLocale } from '$lib/i18n';
  import { currentFolderId } from '../stores/folders';
  import { hiddenWorkspaceLock } from '$lib/stores/workspaceScope';
  import { ChevronDown, Menu, X } from '@lucide/svelte';
  import { chatWidgetLayout } from '$lib/stores/chatWidgetLayout';
  import { fly, fade } from 'svelte/transition';

  let showUserMenu = false;
  let showBurgerMenu = false;
  let isBelowLg = false;
  let currentLocale = 'fr';
  let showLangAccordion = false;
  let showIdentityAccordion = false;
  let belowLgMql: MediaQueryList | null = null;
  // eslint-disable-next-line no-unused-vars
  let belowLgHandler: ((e: MediaQueryListEvent) => void) | null = null;

  $: forceBurger =
    $chatWidgetLayout.mode === 'docked' && $chatWidgetLayout.isOpen && $chatWidgetLayout.dockWidthCss !== '100vw';
  $: showCompactHeader = isBelowLg || forceBurger;

  const closeAllMenus = () => {
    showUserMenu = false;
    showBurgerMenu = false;
    showLangAccordion = false;
    showIdentityAccordion = false;
  };

  const toggleBurgerMenu = () => {
    showBurgerMenu = !showBurgerMenu;
    if (!showBurgerMenu) {
      showLangAccordion = false;
      showIdentityAccordion = false;
    }
  };

  const toggleLangAccordion = () => {
    showLangAccordion = !showLangAccordion;
    if (showLangAccordion) showIdentityAccordion = false;
  };

  const toggleIdentityAccordion = () => {
    showIdentityAccordion = !showIdentityAccordion;
    if (showIdentityAccordion) showLangAccordion = false;
  };

  const navItems = [
    { href: '/', label: 'nav.home' },
    { href: '/dossiers', label: 'nav.folders' },
    { href: '/organisations', label: 'nav.organizations' },
    { href: '/cas-usage', label: 'nav.useCases' },
    { href: '/matrice', label: 'nav.matrix' },
    { href: '/dashboard', label: 'nav.dashboard' },
  ];

  const currentPath = derived(page, ($page) => $page.url.pathname);
  const isIdentityRoute = derived(page, ($page) => {
    const p = $page.url.pathname;
    return p === '/parametres' || p.startsWith('/parametres/') || p === '/auth/devices' || p.startsWith('/auth/devices/');
  });

  // Logique pour déterminer si les menus doivent être grisés (réactif)
  const computeIsMenuDisabled = (href: string, authed: boolean, folderId: string | null, hiddenLock: boolean) => {
    // Si l'utilisateur n'est pas authentifié, griser tous les menus sauf l'accueil (/)
    if (!authed) return href !== '/';

    // Si un workspace caché est sélectionné, restreindre la navigation (Paramètres uniquement).
    // Le redirect est géré globalement dans +layout, mais on grise aussi la navigation pour le feedback UX.
    if (hiddenLock) return true;

    // Si aucun dossier n'est sélectionné, griser cas-usage, matrice et dashboard
    if (!folderId) return href === '/cas-usage' || href === '/matrice' || href === '/dashboard';

    // Si un dossier est sélectionné, ne pas griser (même s'il n'y a pas encore de cas d'usage)
    return false;
  };

  let navDisabledByHref: Record<string, boolean> = {};
  $: navDisabledByHref = Object.fromEntries(
    navItems.map((item) => [item.href, computeIsMenuDisabled(item.href, $isAuthenticated, $currentFolderId, $hiddenWorkspaceLock)])
  );

  const onClickNavItem = (e: MouseEvent, href: string) => {
    if (!navDisabledByHref[href]) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const closeDockedChatIfMobileFullScreen = () => {
    // When the chat is docked in mobile mode, it takes 100vw and hides the newly navigated page.
    // Close the chat so the user can immediately see the destination.
    if (typeof window === 'undefined') return;
    const isMobileFullScreenDock =
      $chatWidgetLayout.mode === 'docked' && $chatWidgetLayout.isOpen && $chatWidgetLayout.dockWidthCss === '100vw';
    if (!isMobileFullScreenDock) return;
    window.dispatchEvent(new CustomEvent('topai:close-chat'));
  };

  const onLocaleChange = (event: Event) => {
    const target = event.target as HTMLSelectElement;
    setLocale(target.value);
  };
  $: currentLocale = ($i18nLocale as string) || 'fr';

  // Le sélecteur de workspace admin est dans /parametres (section Workspace) — pas dans le header.

  const onGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (showBurgerMenu || showUserMenu) closeAllMenus();
  };

  const onExternalToggleBurgerMenu = () => {
    toggleBurgerMenu();
  };

  onMount(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    belowLgMql = window.matchMedia('(max-width: 1023px)');
    isBelowLg = belowLgMql.matches;
    belowLgHandler = (e: MediaQueryListEvent) => {
      isBelowLg = e.matches;
      if (!isBelowLg && !forceBurger) showBurgerMenu = false;
    };
    belowLgMql.addEventListener?.('change', belowLgHandler);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (belowLgMql as any).addListener?.(belowLgHandler);
    window.addEventListener('keydown', onGlobalKeyDown);
    window.addEventListener('topai:toggle-burger-menu', onExternalToggleBurgerMenu as any);
  });

  onDestroy(() => {
    try {
      if (belowLgHandler) belowLgMql?.removeEventListener?.('change', belowLgHandler);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (belowLgMql as any)?.removeListener?.(belowLgHandler);
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onGlobalKeyDown);
    if (typeof window !== 'undefined') window.removeEventListener('topai:toggle-burger-menu', onExternalToggleBurgerMenu as any);
  });
</script>

<header class="border-b border-slate-200 bg-white">
  <div class="mx-auto flex max-w-7xl items-center justify-between px-4 h-14">
    <!-- Desktop nav (hidden in compact mode) -->
    <nav class:hidden={showCompactHeader} class="flex flex-1 flex-wrap items-center gap-4 text-sm font-medium">
      {#each navItems as item}
        {@const isDisabled = !!navDisabledByHref[item.href]}
        <a
          href={item.href}
          aria-disabled={isDisabled}
          tabindex={isDisabled ? -1 : 0}
          class:active-link={$currentPath === item.href}
          class="rounded px-2 py-1 transition {isDisabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100'}"
          on:click={(e) => onClickNavItem(e, item.href)}
          >{$_(item.label)}</a
        >
      {/each}
    </nav>
    <!-- Burger (tablet+ OR forced by docked chat) -->
    <div class:hidden={!showCompactHeader} class="flex flex-1 items-center justify-start">
      <button
        class="inline-flex items-center justify-center rounded p-2 text-slate-700 hover:bg-slate-100"
        on:click={toggleBurgerMenu}
        aria-label="Menu"
        aria-expanded={showBurgerMenu}
        type="button"
      >
        {#if showBurgerMenu}
          <X class="h-5 w-5" aria-hidden="true" />
        {:else}
          <Menu class="h-5 w-5" aria-hidden="true" />
        {/if}
      </button>
    </div>

    <!-- Desktop right controls (hidden in compact mode) -->
    <div class:hidden={showCompactHeader} class="flex items-center gap-3">
      <select class="rounded border border-slate-200 px-2 py-1 text-sm" value={currentLocale} on:change={onLocaleChange}>
        <option value="fr">FR</option>
        <option value="en">EN</option>
      </select>
      {#if $isAuthenticated && $session.user}
        <div class="relative">
          <button
            on:click={() => showUserMenu = !showUserMenu}
            class="flex items-center gap-2 rounded px-3 py-1 text-sm font-medium hover:bg-slate-100 transition"
            class:active-link={$isIdentityRoute}
          >
            <div class="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-medium">
              {($session.user.displayName || $session.user.email || 'U')[0].toUpperCase()}
            </div>
            <span class="text-slate-700">{$session.user.displayName || $session.user.email || 'User'}</span>
            <ChevronDown class="w-4 h-4 text-slate-400" />
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
                class="block px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                class:active-link={$currentPath === '/auth/devices'}
                on:click={() => showUserMenu = false}
              >
                Mes appareils
              </a>
              <a
                href="/parametres"
                class="block px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                class:active-link={$currentPath === '/parametres'}
                on:click={() => showUserMenu = false}
              >
                Paramètres
              </a>
              <div class="border-t border-slate-200 my-1"></div>
              <button
                on:click={() => { showUserMenu = false; logout(); }}
                class="block w-full text-left px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
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

<!-- Compact burger drawer -->
{#if showBurgerMenu}
  <button
    class="fixed inset-0 z-[80] bg-transparent"
    on:click={closeAllMenus}
    aria-label="Close menu"
    transition:fade={{ duration: 120 }}
  ></button>

  <aside
    class="fixed left-0 top-0 z-[90] bg-white border border-slate-200 shadow-lg rounded-none overflow-y-auto"
    style="width: min(22rem, 85vw); max-height: 100vh;"
    transition:fly={{ x: -320, duration: 180 }}
  >
    <div class="px-4 h-14 flex items-center justify-start border-b border-slate-200">
        <button
          class="inline-flex items-center justify-center rounded p-2 text-slate-700 hover:bg-slate-100"
          on:click={closeAllMenus}
          aria-label="Close menu"
          type="button"
        >
          <X class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

    <div class="p-3 space-y-4">
        <nav class="grid gap-1 text-sm font-medium">
          {#each navItems as item}
            {@const isDisabled = !!navDisabledByHref[item.href]}
            <a
              href={item.href}
              aria-disabled={isDisabled}
              tabindex={isDisabled ? -1 : 0}
              class:active-link={$currentPath === item.href}
            class="rounded px-3 py-2 transition {isDisabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-100'}"
              on:click={(e) => {
                onClickNavItem(e, item.href);
                if (!navDisabledByHref[item.href]) {
                  closeDockedChatIfMobileFullScreen();
                  closeAllMenus();
                }
              }}
            >{$_(item.label)}</a
            >
          {/each}
        </nav>

      <!-- Language accordion -->
      <div class="border-t border-slate-200 pt-3">
        <button
          class="w-full flex items-center justify-between rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          on:click={toggleLangAccordion}
          aria-expanded={showLangAccordion}
          type="button"
        >
          <span>Langue</span>
          <ChevronDown
            class="h-4 w-4 text-slate-400 transition-transform {showLangAccordion ? 'rotate-180' : ''}"
            aria-hidden="true"
          />
        </button>
        {#if showLangAccordion}
          <div class="px-3 pb-2">
            <div class="mt-2 grid gap-1">
              <button
                type="button"
                class="w-full rounded px-3 py-2 text-left text-sm font-medium hover:bg-slate-100 {currentLocale === 'fr' ? 'bg-slate-100 text-slate-900' : 'text-slate-700'}"
                on:click={() => setLocale('fr')}
                aria-current={currentLocale === 'fr' ? 'true' : 'false'}
              >
                FR
              </button>
              <button
                type="button"
                class="w-full rounded px-3 py-2 text-left text-sm font-medium hover:bg-slate-100 {currentLocale === 'en' ? 'bg-slate-100 text-slate-900' : 'text-slate-700'}"
                on:click={() => setLocale('en')}
                aria-current={currentLocale === 'en' ? 'true' : 'false'}
              >
                EN
              </button>
            </div>
          </div>
        {/if}
        </div>

      <!-- Identity (bottom of menu content, not bottom of screen) -->
      <div class="border-t border-slate-200 pt-3">
        {#if $isAuthenticated && $session.user}
          <button
            class="w-full flex items-center gap-3 rounded px-3 py-2 hover:bg-slate-100"
            on:click={toggleIdentityAccordion}
            aria-expanded={showIdentityAccordion}
            type="button"
            class:active-link={$isIdentityRoute}
          >
              <div class="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-medium">
                {($session.user.displayName || $session.user.email || 'U')[0].toUpperCase()}
              </div>
            <div class="min-w-0 flex-1 text-left">
                <div class="truncate text-sm font-medium text-slate-800">
                  {$session.user.displayName || $session.user.email || 'User'}
                </div>
                <div class="truncate text-xs text-slate-500">{$session.user.email}</div>
              </div>
            <ChevronDown
              class="h-4 w-4 text-slate-400 transition-transform {showIdentityAccordion ? 'rotate-180' : ''}"
              aria-hidden="true"
            />
          </button>

          {#if showIdentityAccordion}
            <div class="mt-2 grid gap-1 px-3 pb-2">
              {#if $session.user?.id === 'unknown'}
                <button
                  on:click={() => { closeDockedChatIfMobileFullScreen(); closeAllMenus(); retrySessionInit(); }}
                  class="block w-full text-left rounded px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
                >
                  🔄 Actualiser les informations
                </button>
              {/if}
              <a
                href="/auth/devices"
                class="block rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                class:active-link={$currentPath === '/auth/devices'}
                on:click={() => { closeDockedChatIfMobileFullScreen(); closeAllMenus(); }}
              >
                Mes appareils
              </a>
              <a
                href="/parametres"
                class="block rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                class:active-link={$currentPath === '/parametres'}
                on:click={() => { closeDockedChatIfMobileFullScreen(); closeAllMenus(); }}
              >
                Paramètres
              </a>
              <button
                on:click={() => { closeDockedChatIfMobileFullScreen(); closeAllMenus(); logout(); }}
                class="block w-full text-left rounded px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Déconnexion
              </button>
            </div>
          {/if}
        {:else}
          <a
            href="/auth/login"
            class="block rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 transition"
            on:click={() => { closeDockedChatIfMobileFullScreen(); closeAllMenus(); }}
          >
            Connexion
          </a>
        {/if}
      </div>
    </div>
  </aside>
{/if}

<!-- Click outside to close user menu (desktop dropdown only) -->
{#if showUserMenu}
  <button class="fixed inset-0 z-40" on:click={() => showUserMenu = false} aria-label="Close menu"></button>
{/if}

<style>
  :global(.active-link) {
    background-color: rgb(226 232 240);
    color: rgb(15 23 42);
  }
</style>
