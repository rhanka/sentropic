<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { beforeNavigate, goto } from '$app/navigation';
  import '../app.css';
  import '../app.print.css';
  import Header from '$lib/components/Header.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import NavigationGuard from '$lib/components/NavigationGuard.svelte';
  import ChatWidget from '$lib/components/ChatWidget.svelte';
  import '$lib/i18n';
  import { initializeSession, session } from '$lib/stores/session';
  import { chatWidgetLayout } from '$lib/stores/chatWidgetLayout';
  import { organizationsStore, currentOrganizationId } from '$lib/stores/organizations';
  import { foldersStore, currentFolderId } from '$lib/stores/folders';
  import { useCasesStore } from '$lib/stores/useCases';
  import { queueStore } from '$lib/stores/queue';
  import { me } from '$lib/stores/me';
  import { streamHub } from '$lib/stores/streamHub';
  import { hiddenWorkspaceLock, noWorkspaceLock, workspaceScopeHydrated, loadUserWorkspaces, workspaceScope } from '$lib/stores/workspaceScope';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { addToast } from '$lib/stores/toast';

  // Keep header visible on /auth/devices (required for navigation).
  const AUTH_ROUTES = ['/auth/login', '/auth/register', '/auth/magic-link'];

  // Routes publiques (accessibles sans authentification)
  const PUBLIC_ROUTES = [
    '/',
    '/auth/login',
    '/auth/register',
    '/auth/magic-link'
  ];

  // Routes protégées (nécessitent une authentification)
  const PROTECTED_ROUTES = [
    '/home',
    '/organisations',
    '/dossiers',
    '/dossier',
    '/cas-usage',
    '/matrice',
    '/dashboard',
    '/dashboard-tmp',
    '/parametres',
    '/auth/devices'
  ];

  $: hideHeader = AUTH_ROUTES.some((route) => {
    const path = $page.url.pathname;
    return path === route || path.startsWith(`${route}/`);
  });

  // Vérifier si une route est protégée
  function isProtectedRoute(path: string): boolean {
    // Routes dynamiques avec paramètres (ex: /organisations/[id], /organisations/new, /dossiers/[id], /cas-usage/[id])
    // Ces routes sont toutes protégées
    if (
      path.startsWith('/organisations/') ||
      path.startsWith('/dossiers/') || 
      path.startsWith('/dossier/') ||
      path.startsWith('/cas-usage/')
    ) {
      return true;
    }
    // Vérifier les routes exactes protégées
    return PROTECTED_ROUTES.some(route => path === route || path.startsWith(`${route}/`));
  }

  // Vérifier si une route est publique
  function isPublicRoute(path: string): boolean {
    // Page d'erreur (404) est toujours publique
    if ($page.status === 404 || $page.error) {
      return true;
    }
    // Vérifier les routes exactes publiques
    return PUBLIC_ROUTES.some(route => path === route || path.startsWith(`${route}/`));
  }

  // Déterminer si on peut afficher le contenu (pour éviter le flash avant redirection)
  let canShowContent = false;
  $: {
    const path = $page.url.pathname;
    const publicRoute = isPublicRoute(path);
    const protectedRoute = isProtectedRoute(path);
    
    // On peut afficher si :
    // - Route publique : toujours afficher (pas besoin d'attendre la session)
    // - Route protégée : attendre que la session soit chargée ET que l'utilisateur soit authentifié
    // - Route non trouvée (404) : toujours afficher
    canShowContent = publicRoute || (!$session.loading && protectedRoute && !!$session.user);
  }

  // État du spinner avec délais pour éviter les blinks
  let showSpinner = false;
  let showSpinnerTimer: ReturnType<typeof setTimeout> | null = null;
  let hideSpinnerTimer: ReturnType<typeof setTimeout> | null = null;
  let chatDockPaddingRight = '0px';
  let chatDockLeftWidth = '100%';
  let lockBodyScrollForDock = false;

  $: chatDockPaddingRight =
    $chatWidgetLayout.mode === 'docked' && $chatWidgetLayout.isOpen && $chatWidgetLayout.dockWidthCss !== '100vw'
      ? $chatWidgetLayout.dockWidthCss
      : '0px';

  // Docked layout: keep the main page scrollbar on the LEFT pane (before the docked chat),
  // not at the far right of the viewport.
  $: lockBodyScrollForDock =
    $chatWidgetLayout.mode === 'docked' && $chatWidgetLayout.isOpen && $chatWidgetLayout.dockWidthCss !== '100vw';
  $: chatDockLeftWidth = lockBodyScrollForDock ? `calc(100vw - ${$chatWidgetLayout.dockWidthCss})` : '100%';

  // Gérer l'affichage du spinner avec délai de 0.5s
  $: {
    // Nettoyer les timers précédents
    if (showSpinnerTimer) {
      clearTimeout(showSpinnerTimer);
      showSpinnerTimer = null;
    }
    if (hideSpinnerTimer) {
      clearTimeout(hideSpinnerTimer);
      hideSpinnerTimer = null;
    }

    if (!canShowContent && !showSpinner) {
      // canShowContent est false, démarrer le timer pour afficher le spinner après 0.5s
      showSpinnerTimer = setTimeout(() => {
        if (!canShowContent) {
          showSpinner = true;
        }
        showSpinnerTimer = null;
      }, 500);
    } else if (!canShowContent && showSpinner) {
      // Le spinner est affiché et canShowContent redevient false, garder le spinner visible
      // (pas besoin de timer, on reste sur le spinner)
    } else if (canShowContent && showSpinner) {
      // Le spinner est affiché et canShowContent devient true, attendre 0.5s avant de le masquer
      hideSpinnerTimer = setTimeout(() => {
        if (canShowContent) {
          showSpinner = false;
        }
        hideSpinnerTimer = null;
      }, 500);
    } else if (canShowContent && !showSpinner) {
      // canShowContent est true et spinner pas affiché, ne rien faire (afficher directement le contenu)
      showSpinner = false;
    }
  }

  // Initialize session on app mount
  onMount(async () => {
    await initializeSession();
  });

  // Clear all user-scoped stores when the authenticated user changes (incl. logout),
  // to prevent cross-account data "bleed" in the UI.
  let lastUserId: string | null = null;
  let lastAdminScope: string | null = null;
  $: {
    const currentUserId = $session.user?.id ?? null;
    const currentScope = $workspaceScope.selectedId ?? null;

    if (currentUserId !== lastUserId || currentScope !== lastAdminScope) {
      // Ne pas reconnecter SSE à chaque changement de scope (stabilité, un seul SSE).
      // On nettoie uniquement les caches côté UI.
      streamHub.clearCaches();
      organizationsStore.set([]);
      currentOrganizationId.set(null);
      foldersStore.set([]);
      currentFolderId.set(null);
      useCasesStore.set([]);
      queueStore.set({ jobs: [], isLoading: false, lastUpdate: null });
      // `me` représente le profil de l'utilisateur courant (pas le scope admin).
      // On ne le vide que si l'utilisateur change.
      if (currentUserId !== lastUserId) {
        me.set({ loading: false, data: null, error: null });
      }
      lastUserId = currentUserId;
      lastAdminScope = currentScope;

      // Hydrate workspace roles early (prevents read-only banner flash on first navigation).
      if (currentUserId) {
        void loadUserWorkspaces();
      }
    }
  }

  // Nettoyer les timers lors du démontage
  onDestroy(() => {
    if (showSpinnerTimer) {
      clearTimeout(showSpinnerTimer);
    }
    if (hideSpinnerTimer) {
      clearTimeout(hideSpinnerTimer);
    }
  });

  // Reactive check: redirect to login if accessing protected route without authentication
  $: if (!$session.loading) {
    const path = $page.url.pathname;
    const publicRoute = isPublicRoute(path);
    const protectedRoute = isProtectedRoute(path);
    
    // Rediriger vers login uniquement si :
    // - C'est une route protégée
    // - L'utilisateur n'est pas authentifié
    // - Ce n'est pas une page d'erreur (404)
    if (protectedRoute && !publicRoute && !$session.user) {
      goto(`/auth/login?returnUrl=${encodeURIComponent(path)}`);
    }
  }

  // No-workspace lock: if user has zero workspaces, restrict navigation to /parametres.
  let lastNoWorkspaceRedirectPath: string | null = null;
  let noWorkspaceNavCancelInProgress = false;

  // Hidden workspace navigation lock (Option A):
  // - If a hidden workspace is selected (admin role), restrict navigation to /parametres (+ public/auth routes).
  // - Redirect must be immediate (wins over autosave), but autosave can run best-effort in background.
  let lastHiddenLockRedirectPath: string | null = null;
  let hiddenNavCancelInProgress = false;

  onMount(() => {
    // Cancel client-side navigations early to prevent fetching forbidden views before redirect.
    beforeNavigate((nav) => {
      if (hiddenNavCancelInProgress) return;
      if (noWorkspaceNavCancelInProgress) return;
      if (!$session.user || $session.loading) return;
      if (!$workspaceScopeHydrated) return;
      const toPath = nav.to?.url?.pathname;
      if (!toPath) return;

      if ($noWorkspaceLock) {
        const isAllowed =
          toPath === '/parametres' ||
          toPath.startsWith('/parametres/') ||
          toPath.startsWith('/auth/') ||
          isPublicRoute(toPath);

        if (!isAllowed) {
          nav.cancel();
          noWorkspaceNavCancelInProgress = true;
          void goto('/parametres').finally(() => {
            noWorkspaceNavCancelInProgress = false;
          });
        }
        return;
      }

      if (!$hiddenWorkspaceLock) return;

      const isAllowed =
        toPath === '/parametres' ||
        toPath.startsWith('/parametres/') ||
        toPath.startsWith('/auth/') ||
        isPublicRoute(toPath);

      if (!isAllowed) {
        nav.cancel();
        hiddenNavCancelInProgress = true;
        // Best-effort autosave (non-blocking)
        if (unsavedChangesStore.hasUnsavedChanges()) {
          void unsavedChangesStore.saveAll().then((ok) => {
            if (!ok) {
              addToast({
                type: 'warning',
                message:
                  "Espace de travail caché : accès restreint aux Paramètres. Sauvegarde automatique impossible pour certaines modifications.",
              });
            }
          });
        }
        void goto('/parametres').finally(() => {
          hiddenNavCancelInProgress = false;
        });
      }
    });
  });
  $: if (!$session.loading && $session.user && $workspaceScopeHydrated && $noWorkspaceLock) {
    const path = $page.url.pathname;
    const isAllowed =
      path === '/parametres' ||
      path.startsWith('/parametres/') ||
      path.startsWith('/auth/') ||
      isPublicRoute(path);

    if (!isAllowed && path !== lastNoWorkspaceRedirectPath) {
      lastNoWorkspaceRedirectPath = path;
      goto('/parametres');
    }
  } else {
    lastNoWorkspaceRedirectPath = null;
  }

  $: if (!$session.loading && $session.user && $workspaceScopeHydrated && $hiddenWorkspaceLock) {
    const path = $page.url.pathname;
    const isAllowed =
      path === '/parametres' ||
      path.startsWith('/parametres/') ||
      path.startsWith('/auth/') ||
      isPublicRoute(path);

    if (!isAllowed && path !== lastHiddenLockRedirectPath) {
      lastHiddenLockRedirectPath = path;

      goto('/parametres');
    }
  } else {
    lastHiddenLockRedirectPath = null;
  }
</script>

<svelte:head>
  <title>Top AI Ideas</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
  <div
    class="box-border transition-[padding-right,width] duration-200 h-[100dvh] overflow-y-auto slim-scroll"
    style:padding-right={lockBodyScrollForDock ? '0px' : chatDockPaddingRight}
    style:width={lockBodyScrollForDock ? chatDockLeftWidth : '100%'}
  >
    {#if !hideHeader && canShowContent && !showSpinner}
      <Header />
    {/if}
    <main class="mx-auto max-w-7xl px-4 py-8">
      {#if showSpinner}
        <!-- Afficher un loader pendant la vérification de session -->
        <div class="flex items-center justify-center min-h-[60vh]">
          <div class="text-center">
            <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
            <p class="text-sm text-slate-600">Vérification de la session...</p>
          </div>
        </div>
      {:else if canShowContent}
        <slot />
      {/if}
    </main>
    <Toast />
    <NavigationGuard />
  </div>
  {#if $session.user}
    <ChatWidget />
  {/if}
</div>
