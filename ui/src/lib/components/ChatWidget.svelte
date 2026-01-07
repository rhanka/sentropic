<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { queueStore, loadJobs, updateJob, addJob } from '$lib/stores/queue';
  import { apiPost } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import { isAuthenticated, session } from '$lib/stores/session';
  import { streamHub } from '$lib/stores/streamHub';
  import { MessageCircle, Loader2, Clock, X, Plus, Trash2, Minus, Maximize2, Minimize2, Menu } from '@lucide/svelte';
  import { chatWidgetLayout } from '$lib/stores/chatWidgetLayout';

  import QueueMonitor from '$lib/components/QueueMonitor.svelte';
  import ChatPanel from '$lib/components/ChatPanel.svelte';

  type Tab = 'chat' | 'queue';
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
  let headerSelection: string = '__new__'; // '__new__' | '__jobs__' | sessionId

  type DisplayMode = 'floating' | 'docked';
  const DISPLAY_MODE_STORAGE_KEY = 'chatWidgetDisplayMode';
  let displayMode: DisplayMode =
    browser && localStorage.getItem(DISPLAY_MODE_STORAGE_KEY) === 'docked' ? 'docked' : 'floating';
  let dockWidthCss = '0px';

  let bubbleButtonEl: HTMLButtonElement | null = null;
  let dialogEl: HTMLDivElement | null = null;
  let lastActiveElement: HTMLElement | null = null;
  let resizeHandler: (() => void) | null = null;
  let headerSelectEl: HTMLSelectElement | null = null;
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

    // UX: from chat composer -> header select (menus) is the next meaningful target
    if (!e.shiftKey && active.tagName.toLowerCase() === 'textarea' && headerSelectEl) {
      e.preventDefault();
      headerSelectEl.focus();
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
    if (s.primaryContextType && s.primaryContextId) return `${s.primaryContextType}:${s.primaryContextId}`;
    return `Session ${s.id.slice(0, 6)}`;
  };

  $: jobsTotal = $queueStore.jobs.length;
  $: activeJobsCount = $queueStore.jobs.filter((job) => job.status === 'pending' || job.status === 'processing').length;
  $: hasActiveJobs = activeJobsCount > 0;
  $: failedJobsCount = $queueStore.jobs.filter((job) => job.status === 'failed').length;
  $: hasFailedJobs = failedJobsCount > 0;

  $: {
    if (activeTab === 'queue') headerSelection = '__jobs__';
    else if (chatSessionId) headerSelection = chatSessionId;
    else headerSelection = '__new__';
  }

  const handleHeaderSelectionChange = async (value: string) => {
    if (value === '__jobs__') {
      activeTab = 'queue';
      return;
    }
    activeTab = 'chat';
    if (value === '__new__') {
      chatPanelRef?.newSession?.();
      chatSessionId = null;
      return;
    }
    // Important: si on revient sur la même session (après être passé sur Jobs),
    // ne pas recharger les messages/streams, juste réafficher le panel.
    if (value === chatSessionId) {
      return;
    }
    chatSessionId = value;
    await chatPanelRef?.selectSession?.(value);
  };

  const onHeaderSelectionChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    const value = target?.value ?? '__new__';
    void handleHeaderSelectionChange(value);
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
      <!-- Header commun (sélecteur unique: sessions + jobs) -->
      <div class="px-4 h-14 border-b border-gray-200 flex items-center">
        <div class="flex w-full items-center justify-between gap-2">
          <!-- Session / Jobs -->
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

          <select
            class="w-52 min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            bind:value={headerSelection}
            bind:this={headerSelectEl}
            disabled={chatLoadingSessions}
            on:change={onHeaderSelectionChange}
            title="Session / Jobs"
            aria-label="Session / Jobs"
          >
            <option value="__new__">Nouvelle session</option>
            {#if chatSessions.length > 0}
              <optgroup label="Sessions">
                {#each chatSessions as s (s.id)}
                  <option value={s.id}>{formatSessionLabel(s)}</option>
                {/each}
              </optgroup>
            {/if}
            <option value="__jobs__">Jobs IA {jobsTotal ? `(${jobsTotal})` : ''}</option>
          </select>

          <div class="flex items-center gap-2">
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
            {#if activeTab === 'chat'}
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

<style>
  /* Mettre "Jobs IA" en gras dans le sélecteur (support dépend du navigateur, mais OK sur Chromium) */
  select option[value="__jobs__"] {
    font-weight: 700;
  }
</style>


