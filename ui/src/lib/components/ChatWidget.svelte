<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { queueStore, loadJobs, updateJob, addJob } from '$lib/stores/queue';
  import { apiPost } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import { isAuthenticated, session } from '$lib/stores/session';
  import { streamHub } from '$lib/stores/streamHub';
  import { currentFolderId } from '$lib/stores/folders';
  import { workspaceCanComment, selectedWorkspaceRole } from '$lib/stores/workspaceScope';
  import { closeComment, reopenComment, deleteComment } from '$lib/utils/comments';
  import {
    MessageCircle,
    Loader2,
    Clock,
    X,
    Plus,
    Trash2,
    Minus,
    Maximize2,
    Minimize2,
    Menu,
    List,
    Check,
    FolderOpen,
    Eye,
    EyeOff
  } from '@lucide/svelte';
  import { chatWidgetLayout } from '$lib/stores/chatWidgetLayout';

  import QueueMonitor from '$lib/components/QueueMonitor.svelte';
  import ChatPanel from '$lib/components/ChatPanel.svelte';

  type Tab = 'chat' | 'queue' | 'comments';
  let activeTab: Tab = 'chat';
  let isVisible = false;
  let hasOpenedOnce = false;

  // Header Chat (sessions) piloté par ChatPanel via bindings
  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
  };
  let chatPanelRef: any = null;
  let chatSessions: ChatSession[] = [];
  let chatSessionId: string | null = null;
  let chatLoadingSessions = false;
  let commentContext: { type: 'organization' | 'folder' | 'usecase' | 'executive_summary'; id?: string } | null = null;
  let commentContextOverride: { type: 'organization' | 'folder' | 'usecase' | 'executive_summary'; id?: string } | null = null;
  let commentSectionKey: string | null = null;
  let commentSectionLabel: string | null = null;
  let commentThreadId: string | null = null;
  let commentLoading = false;
  let commentThreads: Array<{
    id: string;
    sectionKey: string | null;
    count: number;
    lastAt: string;
    preview: string;
    authorLabel: string;
    status: 'open' | 'closed';
    assignedTo: string | null;
    rootId: string;
    createdBy: string;
  }> = [];
  let pendingCommentAutoSelect = false;
  let pendingCommentAutoSelectReady = false;
  let lastCommentContextKey = '';
  let lastCommentRouteKey = '';
  let showResolvedComments = false;
  let currentCommentThread: {
    id: string;
    sectionKey: string | null;
    count: number;
    lastAt: string;
    preview: string;
    authorLabel: string;
    status: 'open' | 'closed';
    assignedTo: string | null;
    rootId: string;
    createdBy: string;
  } | null = null;
  let visibleCommentThreads: Array<{
    id: string;
    sectionKey: string | null;
    count: number;
    lastAt: string;
    preview: string;
    authorLabel: string;
    status: 'open' | 'closed';
    assignedTo: string | null;
    rootId: string;
  }> = [];
  let resolvedThreads: typeof visibleCommentThreads = [];
  let resolvedCount = 0;
  let isCurrentResolved = false;
  let canResolveCurrent = false;
  let showSessionMenu = false;
  let sessionMenuRef: HTMLDivElement | null = null;
  let sessionMenuButtonRef: HTMLButtonElement | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleSessionMenuClick: ((_: MouseEvent) => void) | null = null;
  let showCommentMenu = false;
  let commentMenuRef: HTMLDivElement | null = null;
  let commentMenuButtonRef: HTMLButtonElement | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleCommentMenuClick: ((_: MouseEvent) => void) | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleCommentSectionClick: ((_: MouseEvent) => void) | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleOpenComments: ((_: CustomEvent) => void) | null = null;

  type DisplayMode = 'floating' | 'docked';
  const DISPLAY_MODE_STORAGE_KEY = 'chatWidgetDisplayMode';
  let displayMode: DisplayMode =
    browser && localStorage.getItem(DISPLAY_MODE_STORAGE_KEY) === 'docked' ? 'docked' : 'floating';
  let dockWidthCss = '0px';

  let bubbleButtonEl: HTMLButtonElement | null = null;
  let dialogEl: HTMLDivElement | null = null;
  let lastActiveElement: HTMLElement | null = null;
  let resizeHandler: (() => void) | null = null;
  let closeButtonEl: HTMLButtonElement | null = null;
  let isMobileViewport = false;
  let effectiveMode: DisplayMode = 'floating';
  let isDocked = false;
  // eslint-disable-next-line no-unused-vars
  let mobileMqlChangeHandler: ((ev: MediaQueryListEvent) => void) | null = null;

  // Mobile UX: prevent "scroll bleed" when the bottom-sheet is open
  let mobileMql: MediaQueryList | null = null;
  let isBrowserReady = false;
  let bodyScrollLocked = false;

  const setBodyScrollLocked = (locked: boolean) => {
    if (typeof document === 'undefined') return;
    if (locked === bodyScrollLocked) return;
    bodyScrollLocked = locked;
    document.body.style.overflow = locked ? 'hidden' : '';
    // iOS: avoid elastic scrolling on background
    document.body.style.touchAction = locked ? 'none' : '';
  };

  const syncScrollLock = () => {
    if (!isBrowserReady) return;
    const isMobile = isMobileViewport;
    setBodyScrollLocked(Boolean(isVisible && isMobile));
  };

  $: effectiveMode = isMobileViewport ? 'docked' : displayMode;
  $: isDocked = effectiveMode === 'docked';

  const computeDockWidthCss = (): string => {
    if (!browser) return '0px';
    const w = window.innerWidth;
    const minWidgetPx = 28 * 16; // 28rem ~= widget width (matches floating width)
    if (w < 640) return '100vw'; // mobile: full screen dock
    if (w < 1024) {
      // Tablet/intermediate: 50%, but if that would be smaller than the widget width, go full screen.
      return w * 0.5 < minWidgetPx ? '100vw' : '50vw';
    }
    // Desktop: prefer ~33%, but if that would be smaller than the widget width, fallback to 50%.
    if (w * 0.33 >= minWidgetPx) return '33vw';
    return w * 0.5 < minWidgetPx ? '100vw' : '50vw';
  };

  const publishLayout = () => {
    // Important: compute from current state, do not rely on reactive $: order.
    // Otherwise switching modes can publish the previous value and invert the padding logic.
    const modeNow: DisplayMode = isMobileViewport ? 'docked' : displayMode;
    chatWidgetLayout.set({
      mode: modeNow,
      isOpen: isVisible && modeNow === 'docked',
      dockWidthCss
    });
  };

  const setDisplayMode = (next: DisplayMode) => {
    displayMode = next;
    if (browser) localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, next);
    publishLayout();
  };

  const toggleDisplayMode = () => {
    setDisplayMode(displayMode === 'docked' ? 'floating' : 'docked');
  };

  const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ];
    const nodes = Array.from(container.querySelectorAll<HTMLElement>(selectors.join(',')));
    return nodes.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  };

  const focusFirstFocusable = async () => {
    if (!browser) return;
    await tick();
    // Prefer the chat composer first (better UX + matches UAT expectation)
    if (activeTab === 'chat') {
      await chatPanelRef?.focusComposer?.();
      const active = document.activeElement as HTMLElement | null;
      if (active && dialogEl?.contains(active)) return;
    }
    const root = dialogEl;
    if (!root) return;
    const focusables = getFocusableElements(root);
    if (focusables.length > 0) {
      focusables[0].focus();
      return;
    }
    root.focus();
  };

  const onDialogKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogEl;
    if (!root) return;
    const focusables = getFocusableElements(root);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;

    // UX: from chat composer -> conversations menu button
    if (!e.shiftKey && active.tagName.toLowerCase() === 'textarea' && sessionMenuButtonRef) {
      e.preventDefault();
      sessionMenuButtonRef.focus();
      return;
    }
    // UX: shift+tab from composer -> close button
    if (e.shiftKey && active.tagName.toLowerCase() === 'textarea' && closeButtonEl) {
      e.preventDefault();
      closeButtonEl.focus();
      return;
    }

    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const formatSessionLabel = (s: ChatSession) => {
    if (s.title) return s.title;
    return `Conversation ${s.id.slice(0, 6)}`;
  };

  $: activeJobsCount = $queueStore.jobs.filter((job) => job.status === 'pending' || job.status === 'processing').length;
  $: hasActiveJobs = activeJobsCount > 0;
  $: failedJobsCount = $queueStore.jobs.filter((job) => job.status === 'failed').length;
  $: hasFailedJobs = failedJobsCount > 0;

  const detectCommentContextFromRoute = (
    routeId: string | null,
    params: Record<string, string>,
    folderId: string | null
  ): { type: 'organization' | 'folder' | 'usecase' | 'executive_summary'; id?: string } | null => {
    if (routeId === '/cas-usage/[id]' && params.id) {
      return { type: 'usecase', id: params.id };
    }
    if (routeId === '/cas-usage' && folderId) {
      return { type: 'folder', id: folderId };
    }
    if (routeId === '/dashboard' && folderId) {
      return { type: 'folder', id: folderId };
    }
    if (routeId === '/matrice' && folderId) {
      return { type: 'folder', id: folderId };
    }
    if (routeId === '/dossiers/[id]' && params.id) {
      return { type: 'folder', id: params.id };
    }
    if (routeId === '/organisations/[id]' && params.id) {
      return { type: 'organization', id: params.id };
    }
    return null;
  };

  $: commentContext =
    commentContextOverride ?? detectCommentContextFromRoute($page.route.id ?? null, $page.params, $currentFolderId);
  $: if (activeTab !== 'chat' && showSessionMenu) showSessionMenu = false;
  $: if (activeTab !== 'comments' && showCommentMenu) showCommentMenu = false;

  $: {
    const detected = detectCommentContextFromRoute($page.route.id ?? null, $page.params, $currentFolderId);
    if (
      commentContextOverride &&
      (!detected ||
        detected.type !== commentContextOverride.type ||
        detected.id !== commentContextOverride.id)
    ) {
      commentContextOverride = null;
    }
  }

  const SECTION_LABELS: Record<string, Record<string, string>> = {
    usecase: {
      description: 'Description',
      problem: 'Problème',
      solution: 'Solution',
      benefits: 'Bénéfices recherchés',
      risks: 'Risques',
      metrics: 'Mesures du succès',
      nextSteps: 'Prochaines étapes',
      technologies: 'Technologies',
      dataSources: 'Sources des données',
      dataObjects: 'Données',
      references: 'Références',
      contact: 'Contact',
      deadline: 'Délai',
    },
    organization: {
      size: 'Taille',
      technologies: 'Technologies',
      products: 'Produits et Services',
      processes: 'Processus Métier',
      kpis: 'Indicateurs de performance',
      challenges: 'Défis Principaux',
      objectives: 'Objectifs Stratégiques',
      references: 'Références',
    },
    folder: {
      description: 'Contexte',
      name: 'Nom du dossier',
    },
    executive_summary: {
      introduction: 'Introduction',
      analyse: 'Analyse',
      recommandation: 'Recommandations',
      synthese: 'Synthèse',
    },
  };

  const getSectionLabel = (type: string | null, key: string | null) => {
    if (!type) return null;
    if (!key) return 'Général';
    return SECTION_LABELS[type]?.[key] ?? key;
  };

  $: commentSectionLabel = getSectionLabel(commentContext?.type ?? null, commentSectionKey);

  $: if (commentContext?.id && commentContext?.type) {
    const nextKey = `${commentContext.type}:${commentContext.id}`;
    if (nextKey !== lastCommentContextKey) {
      lastCommentContextKey = nextKey;
      commentThreadId = null;
      commentSectionKey = null;
      commentSectionLabel = null;
      commentThreads = [];
      pendingCommentAutoSelectReady = false;
    }
  }

  $: {
    const routeKey = `${$page.route.id ?? ''}:${$page.params?.id ?? ''}:${$currentFolderId ?? ''}`;
    if (routeKey !== lastCommentRouteKey) {
      lastCommentRouteKey = routeKey;
      // Reset selection when changing view to avoid stale section/thread.
      commentThreadId = null;
      commentSectionKey = null;
      commentSectionLabel = null;
      commentThreads = [];
      pendingCommentAutoSelect = true;
      pendingCommentAutoSelectReady = false;
    }
  }

  $: if (pendingCommentAutoSelect) {
    if (commentLoading) {
      pendingCommentAutoSelectReady = true;
    } else if (pendingCommentAutoSelectReady || commentThreads.length > 0) {
      const matches = commentSectionKey
        ? commentThreads.filter((t) => t.sectionKey === commentSectionKey && t.status !== 'closed')
        : commentThreads.filter((t) => t.status !== 'closed');
      const next = matches[0] ?? null;
      commentThreadId = next?.id ?? null;
      if (next && next.sectionKey !== commentSectionKey) {
        commentSectionKey = next.sectionKey;
      }
      pendingCommentAutoSelect = false;
      pendingCommentAutoSelectReady = false;
    }
  }

  $: currentCommentThread = commentThreadId
    ? commentThreads.find((t) => t.id === commentThreadId) ?? null
    : null;
  $: isCurrentResolved = currentCommentThread?.status === 'closed';
  $: canResolveCurrent =
    Boolean(currentCommentThread) &&
    (currentCommentThread?.createdBy === $session.user?.id || $selectedWorkspaceRole === 'admin') &&
    $workspaceCanComment;
  $: resolvedThreads = commentThreads.filter((t) => t.status === 'closed');
  $: resolvedCount = resolvedThreads.length;
  $: visibleCommentThreads = showResolvedComments
    ? commentThreads
    : commentThreads.filter((t) => t.status !== 'closed');

  $: if (activeTab === 'comments' && commentThreadId && commentThreads.length > 0 && !commentLoading) {
    const exists = commentThreads.some((t) => t.id === commentThreadId);
    if (!exists) commentThreadId = null;
  }


  const handleSelectSession = async (id: string) => {
    if (id === chatSessionId) return;
    chatSessionId = id;
    await chatPanelRef?.selectSession?.(id);
  };

  const handleNewSession = () => {
    chatPanelRef?.newSession?.();
    chatSessionId = null;
  };

  const onJobUpdate = (evt: any) => {
    if (evt?.type !== 'job_update') return;
    const data = evt.data ?? {};
    const job = data?.job;
    if (!job) return;
    const exists = $queueStore.jobs.some((j) => j.id === job.id);
    if (exists) updateJob(job.id, job);
    else addJob(job);
  };

  // Abonnement léger permanent aux job_update pour garder l'icône de bulle à jour
  $: if ($isAuthenticated) {
    streamHub.setJobUpdates('chatWidgetJobs', onJobUpdate);
  } else {
    streamHub.delete('chatWidgetJobs');
  }

  onMount(async () => {
    isBrowserReady = true;
    if (typeof window !== 'undefined' && 'matchMedia' in window) {
      mobileMql = window.matchMedia('(max-width: 639px)');
      isMobileViewport = mobileMql.matches;
      mobileMqlChangeHandler = (e: MediaQueryListEvent) => {
        isMobileViewport = e.matches;
        syncScrollLock();
        publishLayout();
      };
      mobileMql.addEventListener?.('change', mobileMqlChangeHandler);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (mobileMql as any).addListener?.(mobileMqlChangeHandler);
    }
    dockWidthCss = computeDockWidthCss();
    publishLayout();
    resizeHandler = () => {
      dockWidthCss = computeDockWidthCss();
      publishLayout();
    };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('keydown', globalShortcutHandler);
    window.addEventListener('topai:close-chat', onExternalCloseChat as any);
    handleSessionMenuClick = (event: MouseEvent) => {
      if (!showSessionMenu) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (sessionMenuRef?.contains(target) || sessionMenuButtonRef?.contains(target)) return;
      showSessionMenu = false;
    };
    document.addEventListener('click', handleSessionMenuClick);
    handleCommentMenuClick = (event: MouseEvent) => {
      if (!showCommentMenu) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (commentMenuRef?.contains(target) || commentMenuButtonRef?.contains(target)) return;
      showCommentMenu = false;
    };
    document.addEventListener('click', handleCommentMenuClick);
    handleCommentSectionClick = (event: MouseEvent) => {
      if (!commentContext?.id || !commentContext?.type) return;
      const target = event.target as HTMLElement | null;
      const sectionEl = target?.closest?.('[data-comment-section]') as HTMLElement | null;
      if (!sectionEl) return;
      const sectionKey = sectionEl.getAttribute('data-comment-section');
      if (!sectionKey || sectionKey === commentSectionKey) return;
      commentSectionKey = sectionKey;
      commentThreadId = null;
      pendingCommentAutoSelect = true;
      pendingCommentAutoSelectReady = false;
    };
    document.addEventListener('click', handleCommentSectionClick, true);
    handleOpenComments = (event: CustomEvent) => {
      const detail = event?.detail as { contextType?: string; contextId?: string; sectionKey?: string } | null;
      if (!detail?.contextType || !detail?.contextId) return;
      commentContextOverride = { type: detail.contextType as any, id: detail.contextId };
      activeTab = 'comments';
      commentSectionKey = detail.sectionKey ?? null;
      commentThreadId = null;
      pendingCommentAutoSelect = true;
      pendingCommentAutoSelectReady = false;
      void openWidget();
    };
    window.addEventListener('topai:open-comments', handleOpenComments as any);
    syncScrollLock();
    if ($isAuthenticated) await loadJobs();
  });

  const onBubbleKeyDown = (e: KeyboardEvent) => {
    // Ensure keyboard activation works consistently (Enter/Space)
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void toggle();
    }
  };

  const globalShortcutHandler = (e: KeyboardEvent) => {
    // Ctrl+Shift+K toggles the widget (avoid triggering while typing)
    if (!e.ctrlKey || !e.shiftKey || (e.key !== 'K' && e.key !== 'k')) return;
    // If open, always allow closing (even while typing)
    if (isVisible) {
      e.preventDefault();
      close();
      return;
    }
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target as any)?.isContentEditable) return;
    e.preventDefault();
    void toggle();
  };

  const onExternalCloseChat = () => {
    // Only close automatically when the chat is docked full screen on mobile.
    if (!isDocked || !isMobileViewport) return;
    if (!isVisible) return;
    close();
  };

  const toggle = async () => {
    if (browser) lastActiveElement = (document.activeElement as HTMLElement | null) ?? null;
    isVisible = !isVisible;
    if (isVisible) hasOpenedOnce = true;
    syncScrollLock();
    publishLayout();
    if (isVisible) void focusFirstFocusable();
  };

  const openWidget = async () => {
    if (isVisible) return;
    if (browser) lastActiveElement = (document.activeElement as HTMLElement | null) ?? null;
    isVisible = true;
    hasOpenedOnce = true;
    syncScrollLock();
    publishLayout();
    await focusFirstFocusable();
  };

  const handleNewCommentThread = () => {
    commentThreadId = null;
    pendingCommentAutoSelect = false;
  };

  const handleDeleteCommentThread = async () => {
    if (!commentThreadId || !currentCommentThread) return;
    if (!confirm('Supprimer cette conversation de commentaires ?')) return;
    try {
      await deleteComment(currentCommentThread.rootId);
      commentThreadId = null;
      pendingCommentAutoSelect = false;
    } catch {
      // ignore for now
    }
  };

  const selectNextOpenThreadAfterResolve = (current: typeof currentCommentThread) => {
    const openThreads = commentThreads.filter((t) => t.status !== 'closed' && t.id !== current?.id);
    if (openThreads.length === 0) {
      commentThreadId = null;
      return;
    }
    if (commentSectionKey) {
      const nextSameSection = openThreads.find((t) => t.sectionKey === commentSectionKey);
      if (nextSameSection) {
        commentThreadId = nextSameSection.id;
        return;
      }
      commentThreadId = null;
      return;
    }
    const nextSectionThread = openThreads.find((t) => t.sectionKey && t.sectionKey !== current?.sectionKey) ?? openThreads[0];
    commentThreadId = nextSectionThread?.id ?? null;
    if (nextSectionThread?.sectionKey) {
      commentSectionKey = nextSectionThread.sectionKey;
    }
  };

  const handleResolveCommentThread = async () => {
    if (!currentCommentThread || !canResolveCurrent) return;
    try {
      if (currentCommentThread.status === 'closed') {
        await reopenComment(currentCommentThread.rootId);
      } else {
        await closeComment(currentCommentThread.rootId);
      }
      await chatPanelRef?.refreshCommentThreads?.();
      if (currentCommentThread.status !== 'closed') {
        selectNextOpenThreadAfterResolve(currentCommentThread);
      }
    } catch {
      // ignore for now
    }
  };

  const close = () => {
    isVisible = false;
    syncScrollLock();
    publishLayout();
    if (browser) {
      void tick().then(() => {
        if (bubbleButtonEl) {
          bubbleButtonEl.focus();
          return;
        }
        lastActiveElement?.focus?.();
      });
    }
  };

  const handlePurgeMyJobs = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUS vos jobs IA ? Cette action est irréversible.')) {
      return;
    }
    try {
      const result = await apiPost('/queue/purge-mine', { status: 'all' });
      addToast({ type: 'success', message: result.message });
      await loadJobs();
    } catch (error) {
      console.error('Failed to purge my jobs:', error);
      addToast({ type: 'error', message: 'Erreur lors de la suppression de vos jobs' });
    }
  };

  const handlePurgeAllJobsGlobal = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUS les jobs (global) ? Cette action est irréversible.')) {
      return;
    }
    try {
      // Admin-only: purge across ALL workspaces
      const result = await apiPost('/queue/purge-global', { status: 'all' });
      addToast({ type: 'success', message: result.message });
      await loadJobs();
    } catch (error) {
      console.error('Failed to purge ALL jobs (global):', error);
      addToast({ type: 'error', message: 'Erreur lors de la suppression de tous les jobs (global)' });
    }
  };

  onDestroy(() => {
    try {
      if (mobileMqlChangeHandler) mobileMql?.removeEventListener?.('change', mobileMqlChangeHandler);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (mobileMql as any)?.removeListener?.(mobileMqlChangeHandler);
    } catch {
      // ignore
    }
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('keydown', globalShortcutHandler);
    window.removeEventListener('topai:close-chat', onExternalCloseChat as any);
    if (handleSessionMenuClick) document.removeEventListener('click', handleSessionMenuClick);
    if (handleCommentMenuClick) document.removeEventListener('click', handleCommentMenuClick);
    if (handleCommentSectionClick) document.removeEventListener('click', handleCommentSectionClick, true);
    if (handleOpenComments) window.removeEventListener('topai:open-comments', handleOpenComments as any);
    setBodyScrollLocked(false);
    publishLayout();
    streamHub.delete('chatWidgetJobs');
  });
</script>

<div class="queue-monitor fixed bottom-4 right-4 z-50">
  <!-- Bulle unique (commune Chat/Queue) -->
  <button
    class="relative bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-colors"
    class:opacity-0={isVisible}
    class:pointer-events-none={isVisible}
    on:click={toggle}
    on:keydown={onBubbleKeyDown}
    title="Chat / Jobs IA"
    aria-label="Chat / Jobs IA"
    aria-haspopup="dialog"
    aria-expanded={isVisible}
    aria-controls="chat-widget-dialog"
    bind:this={bubbleButtonEl}
    type="button"
  >
    <!-- Icône principale: chat (toujours visible) -->
    <MessageCircle class="w-6 h-6" aria-hidden="true" />

    <!-- Badge: loading (petit spinner) -->
    {#if $queueStore.isLoading}
      <span class="absolute top-1 right-1 text-white rounded-full p-1 shadow">
        <Loader2 class="w-3 h-3 animate-spin" />
      </span>
    {:else if hasActiveJobs}
      <!-- Badge: jobs en cours => montre -->
      <span class="absolute top-1 right-1 text-white rounded-full p-1 shadow" title={`${activeJobsCount} job(s) en cours`}>
        <Clock class="w-3 h-3" aria-hidden="true" />
      </span>
    {:else if hasFailedJobs}
      <!-- Badge: au moins un job en échec -->
      <span class="absolute -top-1 -right-1 bg-white text-red-600 rounded-full p-1 shadow" title={`${failedJobsCount} job(s) en échec`}>
        <X class="w-3 h-3" aria-hidden="true" />
      </span>
    {/if}
  </button>

  {#if hasOpenedOnce}
    {#if !isDocked}
      <div class="fixed inset-0 z-40 sm:hidden" class:hidden={!isVisible} aria-hidden="true">
        <!-- Mobile backdrop (click to close) -->
        <button
          type="button"
          class="absolute inset-0 h-full w-full bg-slate-900/40"
          on:click={close}
          tabindex="-1"
          aria-hidden="true"
        ></button>
      </div>
    {/if}

    <!-- Window mounted once, then hide/show to avoid remount + API calls -->
    <div
      id="chat-widget-dialog"
      role="dialog"
      aria-label="Chat / Jobs IA"
      aria-modal={isDocked ? 'false' : 'true'}
      tabindex="-1"
      bind:this={dialogEl}
      on:keydown={onDialogKeyDown}
      class={isDocked
        ? 'fixed top-0 right-0 bottom-0 z-50 bg-white border-l border-gray-200 overflow-hidden flex flex-col'
        : 'fixed inset-x-0 bottom-0 z-50 bg-white shadow-2xl border border-gray-200 overflow-hidden flex flex-col h-[85dvh] max-h-[calc(100dvh-1rem)] rounded-t-xl sm:absolute sm:inset-auto sm:bottom-0 sm:right-0 sm:h-[70vh] sm:max-h-[calc(100vh-2rem)] sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-lg'}
      style={isDocked ? `width: ${dockWidthCss};` : ''}
      class:hidden={!isVisible}
    >
      <!-- Header commun (tabs) -->
      <div class="px-4 h-14 border-b border-gray-200 flex items-center">
        <div class="flex w-full items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            {#if isDocked && isMobileViewport}
              <button
                class="inline-flex items-center justify-center rounded p-2 text-slate-700 hover:bg-slate-100"
                on:click={() => window.dispatchEvent(new CustomEvent('topai:toggle-burger-menu'))}
                aria-label="Menu"
                type="button"
              >
                <Menu class="h-5 w-5" aria-hidden="true" />
              </button>
            {/if}

            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1 rounded bg-slate-50 p-1">
              <button
                class="rounded px-2 py-1 text-xs transition {activeTab === 'comments' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
                type="button"
                on:click={() => (activeTab = 'comments')}
              >
                Commentaires
              </button>
              <button
                class="rounded px-2 py-1 text-xs transition {activeTab === 'chat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
                type="button"
                on:click={() => (activeTab = 'chat')}
              >
                Chat IA
              </button>
              <button
                class="rounded px-2 py-1 text-xs transition {activeTab === 'queue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
                type="button"
                on:click={() => (activeTab = 'queue')}
              >
                Jobs IA
              </button>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            {#if activeTab === 'chat'}
              <div class="relative">
                <button
                  class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                  on:click={() => (showSessionMenu = !showSessionMenu)}
                  title="Choisir une conversation"
                  aria-label="Choisir une conversation"
                  type="button"
                  bind:this={sessionMenuButtonRef}
                >
                  <List class="w-4 h-4" />
                </button>
                {#if showSessionMenu}
                  <div
                    class="absolute right-0 mt-2 w-60 rounded-lg border border-slate-200 bg-white shadow-lg p-2 z-20"
                    bind:this={sessionMenuRef}
                  >
                    <button
                      class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50"
                      type="button"
                      on:click={() => {
                        showSessionMenu = false;
                        handleNewSession();
                      }}
                    >
                      Nouvelle session
                    </button>
                    <div class="border-t border-slate-100 my-1"></div>
                    {#if chatLoadingSessions}
                      <div class="px-2 py-1 text-[11px] text-slate-500">Chargement...</div>
                    {:else if chatSessions.length === 0}
                      <div class="px-2 py-1 text-[11px] text-slate-500">Aucune conversation</div>
                    {:else}
                      <div class="max-h-48 overflow-auto slim-scroll">
                        {#each chatSessions as s (s.id)}
                          <button
                            class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 {chatSessionId === s.id ? 'text-slate-900 font-semibold' : 'text-slate-600'}"
                            type="button"
                            on:click={() => {
                              showSessionMenu = false;
                              void handleSelectSession(s.id);
                            }}
                          >
                            {formatSessionLabel(s)}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
              <button
                class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                on:click={() => chatPanelRef?.newSession?.()}
                title="Nouvelle session"
                aria-label="Nouvelle session"
                type="button"
              >
                <Plus class="w-4 h-4" />
              </button>

              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                on:click={() => chatPanelRef?.deleteCurrentSession?.()}
                title="Supprimer la conversation"
                aria-label="Supprimer la conversation"
                type="button"
                disabled={!chatSessionId}
              >
                <Trash2 class="w-4 h-4" />
              </button>
            {/if}
            {#if activeTab === 'comments'}
              <div class="relative">
                <button
                  class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                  on:click={() => (showCommentMenu = !showCommentMenu)}
                  title="Choisir une conversation"
                  aria-label="Choisir une conversation"
                  type="button"
                  bind:this={commentMenuButtonRef}
                >
                  <List class="w-4 h-4" />
                </button>
                {#if showCommentMenu}
                  <div
                    class="absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 bg-white shadow-lg p-2 z-20"
                    bind:this={commentMenuRef}
                  >
                    {#if resolvedCount > 0}
                      <button
                        class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 flex items-center gap-2"
                        type="button"
                        on:click|stopPropagation={() => {
                          showResolvedComments = !showResolvedComments;
                          showCommentMenu = true;
                        }}
                      >
                        {#if showResolvedComments}
                          <Eye class="w-3.5 h-3.5" />
                          <span>Masquer les commentaires résolus</span>
                        {:else}
                          <EyeOff class="w-3.5 h-3.5" />
                          <span>Afficher les commentaires résolus</span>
                        {/if}
                      </button>
                      <div class="border-t border-slate-100 my-1"></div>
                    {/if}
                    <button
                      class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50"
                      type="button"
                      on:click={() => {
                        showCommentMenu = false;
                        commentThreadId = null;
                      }}
                    >
                      Nouvelle conversation{commentSectionLabel ? ` — ${commentSectionLabel}` : ''}
                    </button>
                    <div class="border-t border-slate-100 my-1"></div>
                    {#if visibleCommentThreads.length === 0}
                      <div class="px-2 py-1 text-[11px] text-slate-500">Aucune conversation</div>
                    {:else}
                      <div class="max-h-56 overflow-auto slim-scroll space-y-1">
                        {#each visibleCommentThreads as t (t.id)}
                          <button
                            class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 {commentThreadId === t.id ? 'text-slate-900 font-semibold' : 'text-slate-600'} {t.status === 'closed' ? 'line-through text-slate-400' : ''}"
                            type="button"
                            on:click={() => {
                              showCommentMenu = false;
                              commentThreadId = t.id;
                              commentSectionKey = t.sectionKey;
                              commentSectionLabel = getSectionLabel(commentContext?.type ?? null, t.sectionKey);
                            }}
                          >
                            <div class="flex items-center justify-between gap-2">
                              <span class="truncate">
                                {getSectionLabel(commentContext?.type ?? null, t.sectionKey) || 'Commentaires'}
                              </span>
                              <span class="inline-flex items-center gap-1 text-[10px] text-slate-400">
                                <MessageCircle class="w-3 h-3" />
                                {t.count}
                              </span>
                            </div>
                            <div class="text-[10px] text-slate-400 truncate">
                              {t.authorLabel} — {t.preview}
                            </div>
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
              <button
                class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                on:click={handleNewCommentThread}
                title="Nouvelle conversation"
                aria-label="Nouvelle conversation"
                type="button"
              >
                <Plus class="w-4 h-4" />
              </button>
              <button
                class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
                on:click={() => void handleResolveCommentThread()}
                title={isCurrentResolved ? 'Réouvrir' : 'Résoudre'}
                aria-label={isCurrentResolved ? 'Réouvrir' : 'Résoudre'}
                type="button"
                disabled={!currentCommentThread || !canResolveCurrent}
              >
                {#if isCurrentResolved}
                  <FolderOpen class="w-4 h-4" />
                {:else}
                  <Check class="w-4 h-4" />
                {/if}
              </button>
              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                on:click={() => void handleDeleteCommentThread()}
                title="Supprimer la conversation"
                aria-label="Supprimer la conversation"
                type="button"
                disabled={!commentThreadId}
              >
                <Trash2 class="w-4 h-4" />
              </button>
            {/if}
            {#if activeTab === 'queue'}
              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                on:click={handlePurgeMyJobs}
                title="Supprimer tous mes jobs"
                aria-label="Supprimer tous mes jobs"
                type="button"
              >
                <Trash2 class="w-4 h-4" />
              </button>
              {#if $session.user?.role === 'admin_app'}
                <button
                  class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                  on:click={handlePurgeAllJobsGlobal}
                  title="Supprimer tous les jobs (global)"
                  aria-label="Supprimer tous les jobs (global)"
                  type="button"
                >
                  <Minus class="w-4 h-4" />
                </button>
              {/if}
            {/if}
            <!-- Desktop-only: hide below lg to avoid UI duplication in responsive header layouts -->
            <button
              class="hidden lg:inline-flex text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
              on:click={toggleDisplayMode}
              title={isDocked ? 'Basculer en widget' : 'Basculer en panneau'}
              aria-label={isDocked ? 'Basculer en widget' : 'Basculer en panneau'}
              type="button"
            >
              {#if isDocked}
                <Minimize2 class="w-4 h-4" aria-hidden="true" />
              {:else}
                <Maximize2 class="w-4 h-4" aria-hidden="true" />
              {/if}
            </button>
            <button class="text-gray-400 hover:text-gray-600" on:click={close} aria-label="Fermer" type="button" bind:this={closeButtonEl}>
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <!-- Contenu (QueueMonitor inchangé hors header) -->
      <div class="flex-1 min-h-0">
        {#if activeTab === 'queue'}
          <div class="h-full min-h-0">
            <QueueMonitor />
          </div>
        {/if}
        {#if activeTab === 'comments'}
          <div class="h-full min-h-0">
            {#if commentContext?.id}
              <ChatPanel
                mode="comments"
                bind:commentThreads
                bind:commentThreadId
                bind:commentLoading
                {commentSectionKey}
                {commentSectionLabel}
                commentContextType={commentContext.type}
                commentContextId={commentContext.id}
              />
            {:else}
              <div class="h-full rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">
                Aucun contexte sélectionné. Ouvre un dossier, une organisation ou un cas d’usage.
              </div>
            {/if}
          </div>
        {/if}
        <div class="h-full" class:hidden={activeTab !== 'chat'}>
          <ChatPanel
            bind:this={chatPanelRef}
            bind:sessions={chatSessions}
            bind:sessionId={chatSessionId}
            bind:loadingSessions={chatLoadingSessions}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

