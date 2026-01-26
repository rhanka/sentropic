<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/stores';
  import { apiGet, apiPost, apiDelete, ApiError } from '$lib/utils/api';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { currentFolderId } from '$lib/stores/folders';
  import { Send, ThumbsUp, ThumbsDown } from '@lucide/svelte';

  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
    createdAt?: string;
    updatedAt?: string | null;
  };

  type ChatMessage = {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content?: string | null;
    reasoning?: string | null;
    sequence?: number;
    createdAt?: string;
    feedbackVote?: number | null;
  };

  type LocalMessage = ChatMessage & {
    _localStatus?: 'processing' | 'completed' | 'failed';
    _streamId?: string;
  };

  type StreamEvent = { eventType: string; data: any; sequence: number; createdAt?: string };

  export let sessions: ChatSession[] = [];
  export let sessionId: string | null = null;
  export let loadingSessions = false;

  let messages: LocalMessage[] = [];
  let loadingMessages = false;
  let sending = false;
  let errorMsg: string | null = null;
  let input = '';
  let listEl: HTMLDivElement | null = null;
  let composerEl: HTMLTextAreaElement | null = null;
  let followBottom = true;
  let scrollScheduled = false;
  let scrollForcePending = false;
  const BOTTOM_THRESHOLD_PX = 96;

  // Historique batch (Option C): messageId -> events
  let initialEventsByMessageId = new Map<string, StreamEvent[]>();
  let streamDetailsLoading = false;
  const terminalRefreshInFlight = new Set<string>();
  const jobPollInFlight = new Set<string>();

  /**
   * Détecte le contexte depuis la route actuelle
   * Retourne { primaryContextType, primaryContextId? } ou null si pas de contexte
   */
  const detectContextFromRoute = (): { primaryContextType: string; primaryContextId?: string } | null => {
    const routeId = $page.route.id;
    const params = $page.params;

    // /cas-usage/[id] → usecase
    if (routeId === '/cas-usage/[id]' && params.id) {
      return { primaryContextType: 'usecase', primaryContextId: params.id };
    }

    // /cas-usage → use case list; when a folder is selected, treat chat context as folder
    if (routeId === '/cas-usage' && $currentFolderId) {
      return { primaryContextType: 'folder', primaryContextId: $currentFolderId };
    }

    // /dashboard → dashboard is folder-scoped when a folder is selected
    if (routeId === '/dashboard' && $currentFolderId) {
      return { primaryContextType: 'folder', primaryContextId: $currentFolderId };
    }

    // /matrice → matrix view is folder-scoped when a folder is selected
    if (routeId === '/matrice' && $currentFolderId) {
      return { primaryContextType: 'folder', primaryContextId: $currentFolderId };
    }

    // /dossiers/[id] → folder
    if (routeId === '/dossiers/[id]' && params.id) {
      return { primaryContextType: 'folder', primaryContextId: params.id };
    }

    // /organisations/[id] → organization
    if (routeId === '/organisations/[id]' && params.id) {
      return { primaryContextType: 'organization', primaryContextId: params.id };
    }

    // /organisations → organizations list (organization scope without a specific id)
    if (routeId === '/organisations') {
      return { primaryContextType: 'organization' };
    }

    // /dossiers → folders list (folder scope without a specific id)
    if (routeId === '/dossiers') {
      return { primaryContextType: 'folder' };
    }

    // Pas de contexte détecté
    return null;
  };

  const isNearBottom = (): boolean => {
    if (!listEl) return true;
    const remaining = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    return remaining < BOTTOM_THRESHOLD_PX;
  };

  const scheduleScrollToBottom = (opts?: { force?: boolean }) => {
    if (opts?.force) scrollForcePending = true;
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      const force = scrollForcePending;
      scrollForcePending = false;
      if (!force && !followBottom) return;
      void scrollChatToBottomStable();
    });
  };

  const onListScroll = () => {
    followBottom = isNearBottom();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  export const focusComposer = async () => {
    await tick();
    composerEl?.focus();
  };

  const scrollChatToBottomStable = async () => {
    await tick();
    if (!listEl) return;
    // Attendre quelques frames pour les variations de layout (StreamMessage, fonts, etc.)
    let lastHeight = -1;
    for (let i = 0; i < 4; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const h = listEl.scrollHeight;
      if (h === lastHeight) break;
      lastHeight = h;
      try {
        listEl.scrollTop = listEl.scrollHeight;
      } catch {
        // ignore
      }
    }
  };

  const formatApiError = (e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      const base = typeof e.message === 'string' ? e.message : String(e.message);
      if (e.status) return `HTTP ${e.status}: ${base}`;
      return base;
    }
    return fallback;
  };

  const loadSessions = async () => {
    loadingSessions = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessions: ChatSession[] }>('/chat/sessions');
      sessions = res.sessions ?? [];
      if (!sessionId && sessions.length > 0) {
        await selectSession(sessions[0].id);
      }
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors du chargement des sessions');
    } finally {
      loadingSessions = false;
    }
  };

  const loadMessages = async (id: string, opts?: { scrollToBottom?: boolean; silent?: boolean }) => {
    const shouldShowLoader = !opts?.silent;
    if (shouldShowLoader) loadingMessages = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessionId: string; messages: ChatMessage[] }>(`/chat/sessions/${id}/messages`);
      const raw = res.messages ?? [];
      messages = raw.map((m) => ({
        ...m,
        _streamId: m.id,
        _localStatus: m.content ? 'completed' : undefined
      }));
      if (opts?.scrollToBottom !== false) scheduleScrollToBottom({ force: true });

      // Hydratation batch (Option C) en arrière-plan: ne doit pas bloquer l'affichage des messages
      initialEventsByMessageId = new Map();
      streamDetailsLoading = true;
      void (async () => {
        try {
          const hist = await apiGet<{ sessionId: string; streams: Array<{ messageId: string; events: StreamEvent[] }> }>(
            `/chat/sessions/${id}/stream-events?limitMessages=20&limitEvents=2000`
          );
          if (sessionId !== id) return;
          const map = new Map<string, StreamEvent[]>();
          for (const item of (hist as any)?.streams ?? []) {
            const mid = String(item?.messageId ?? '').trim();
            if (!mid) continue;
            map.set(mid, (item as any)?.events ?? []);
          }
          initialEventsByMessageId = map;
        } catch {
          initialEventsByMessageId = new Map();
        } finally {
          if (sessionId === id) streamDetailsLoading = false;
        }
      })();

      // Le scroll est exécuté via afterUpdate (une fois le DOM réellement rendu).
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors du chargement des messages');
    } finally {
      if (shouldShowLoader) loadingMessages = false;
    }
  };

  export const selectSession = async (id: string) => {
    sessionId = id;
    await loadMessages(id, { scrollToBottom: true });
  };

  export const newSession = () => {
    sessionId = null;
    messages = [];
    initialEventsByMessageId = new Map();
    errorMsg = null;
    scheduleScrollToBottom({ force: true });
  };

  export const deleteCurrentSession = async () => {
    if (!sessionId) return;
    if (!confirm('Supprimer cette conversation ?')) return;
    errorMsg = null;
    try {
      await apiDelete(`/chat/sessions/${sessionId}`);
      sessionId = null;
      messages = [];
      initialEventsByMessageId = new Map();
      await loadSessions();
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de la suppression de la session');
    }
  };

  const handleAssistantTerminal = async (streamId: string, t: 'done' | 'error') => {
    if (terminalRefreshInFlight.has(streamId)) return;
    terminalRefreshInFlight.add(streamId);
    messages = messages.map((m) =>
      (m._streamId ?? m.id) === streamId ? { ...m, _localStatus: t === 'done' ? 'completed' : 'failed' } : m
    );
    // Silent refresh: keep the message list mounted to avoid a visible "blink" at stream completion.
    if (sessionId) await loadMessages(sessionId, { scrollToBottom: true, silent: true });
    scheduleScrollToBottom({ force: true });
    // Laisser le temps à la UI de se stabiliser avant d'autoriser un autre refresh (évite boucles sur replay).
    await tick();
    terminalRefreshInFlight.delete(streamId);
  };

  const pollJobUntilTerminal = async (jobId: string, streamId: string, opts?: { timeoutMs?: number }) => {
    if (!jobId || !streamId) return;
    if (jobPollInFlight.has(jobId)) return;
    jobPollInFlight.add(jobId);
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const startedAt = Date.now();
    try {
      // Petit délai: si SSE marche, on évite de poller tout de suite
      await new Promise((r) => setTimeout(r, 750));

      while (Date.now() - startedAt < timeoutMs) {
        // Si entre-temps le message a été hydraté (contenu final) ou marqué terminal, on stop
        const current = messages.find((m) => (m._streamId ?? m.id) === streamId);
        if (!current) return;
        if (current.content && current.content.trim().length > 0) return;
        if (current._localStatus === 'completed' || current._localStatus === 'failed') return;

        // Queue: endpoint user-scopé
        const job = await apiGet<{ status?: string }>(`/queue/jobs/${encodeURIComponent(jobId)}`);
        const status = String((job as any)?.status ?? 'unknown');

        if (status === 'completed') {
          await handleAssistantTerminal(streamId, 'done');
          return;
        }
        if (status === 'failed') {
          await handleAssistantTerminal(streamId, 'error');
          return;
        }
        // pending/processing
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch {
      // ignore (fallback best-effort)
    } finally {
      jobPollInFlight.delete(jobId);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    sending = true;
    errorMsg = null;
    try {
      // Détecter le contexte depuis la route
      const context = detectContextFromRoute();

      // Construire le payload avec le contexte si disponible
      const payload: {
        sessionId?: string;
        content: string;
        primaryContextType?: string;
        primaryContextId?: string;
        workspace_id?: string;
      } = {
        content: text
      };

      if (sessionId) {
        payload.sessionId = sessionId;
      }

      if (context) {
        payload.primaryContextType = context.primaryContextType;
        if (context.primaryContextId) payload.primaryContextId = context.primaryContextId;
      }

      const res = await apiPost<{
        sessionId: string;
        userMessageId: string;
        assistantMessageId: string;
        streamId: string;
        jobId: string;
      }>('/chat/messages', payload);

      input = '';
      if (res.sessionId && res.sessionId !== sessionId) {
        sessionId = res.sessionId;
        void loadSessions();
      }

      const nowIso = new Date().toISOString();
      const userMsg: LocalMessage = {
        id: res.userMessageId,
        sessionId: res.sessionId,
        role: 'user',
        content: text,
        createdAt: nowIso,
        _localStatus: 'completed'
      };
      const assistantMsg: LocalMessage = {
        id: res.assistantMessageId,
        sessionId: res.sessionId,
        role: 'assistant',
        content: null,
        createdAt: nowIso,
        _localStatus: 'processing',
        _streamId: res.streamId
      };
      messages = [...messages, userMsg, assistantMsg];
      followBottom = true;
      scheduleScrollToBottom({ force: true });

      // Fallback: si SSE rate les events (connection pas prête), on rattrape via polling queue.
      // On évite ainsi un "Préparation…" bloqué alors que le job est déjà terminé.
      void pollJobUntilTerminal(res.jobId, assistantMsg._streamId ?? assistantMsg.id, { timeoutMs: 90_000 });
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de l’envoi');
    } finally {
      sending = false;
    }
  };

  const setFeedback = async (messageId: string, next: 'up' | 'down' | 'clear') => {
    errorMsg = null;
    try {
      await apiPost(`/chat/messages/${encodeURIComponent(messageId)}/feedback`, { vote: next });
      const voteValue = next === 'clear' ? null : (next === 'up' ? 1 : -1);
      messages = messages.map((m) => (m.id === messageId ? { ...m, feedbackVote: voteValue } : m));
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de la mise à jour du feedback');
    }
  };

  onMount(async () => {
    await loadSessions();
    if (sessionId && messages.length === 0) {
      await loadMessages(sessionId, { scrollToBottom: true });
    }
  });
</script>

<div class="flex flex-col h-full">

  <div
    class="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 slim-scroll"
    style="scrollbar-gutter: stable;"
    bind:this={listEl}
    on:scroll={onListScroll}
  >
    {#if errorMsg}
      <div class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
        {errorMsg}
      </div>
    {/if}
    {#if loadingMessages}
      <div class="text-xs text-slate-500">Chargement…</div>
    {:else if messages.length === 0}
      <div class="text-xs text-slate-500">Aucun message. Écris un message pour démarrer.</div>
    {:else}
      {#each messages as m (m.id)}
        {#if m.role === 'user'}
          <div class="flex justify-end">
            <div class="max-w-[85%] rounded bg-slate-900 text-white text-xs px-3 py-2 whitespace-pre-wrap break-words">
              {m.content}
            </div>
          </div>
        {:else if m.role === 'assistant'}
          {@const sid = m._streamId ?? m.id}
          {@const initEvents = initialEventsByMessageId.get(sid)}
          {@const showDetailWaiter = !!m.content && streamDetailsLoading && initEvents === undefined}
          {@const isUp = m.feedbackVote === 1}
          {@const isDown = m.feedbackVote === -1}
          {@const isTerminal = (m._localStatus ?? (m.content ? 'completed' : 'processing')) === 'completed'}
          <div class="flex justify-start">
            <div class="max-w-[85%] w-full">
              <StreamMessage
                variant="chat"
                streamId={sid}
                status={m._localStatus ?? (m.content ? 'completed' : 'processing')}
                finalContent={m.content ?? null}
                historySource="stream"
                initialEvents={initEvents}
                historyPending={showDetailWaiter}
                onStreamEvent={() => scheduleScrollToBottom()}
                onTerminal={(t) => void handleAssistantTerminal(sid, t)}
              />
              {#if isTerminal}
                <div class="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-500">
                  <button
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    class:text-slate-900={isUp}
                    class:bg-slate-100={isUp}
                    on:click={() => void setFeedback(m.id, isUp ? 'clear' : 'up')}
                    type="button"
                    aria-label="Utile"
                    title="Utile"
                  >
                    <ThumbsUp class="w-3.5 h-3.5" fill={isUp ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    class:text-slate-900={isDown}
                    class:bg-slate-100={isDown}
                    on:click={() => void setFeedback(m.id, isDown ? 'clear' : 'down')}
                    type="button"
                    aria-label="Pas utile"
                    title="Pas utile"
                  >
                    <ThumbsDown class="w-3.5 h-3.5" fill={isDown ? 'currentColor' : 'none'} />
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <div class="p-3 border-t border-slate-200">
    <div class="flex items-center gap-2">
      <textarea
        class="flex-1 min-w-0 rounded border border-slate-300 bg-white px-3 py-2 text-xs resize-none h-10"
        rows="1"
        bind:value={input}
        bind:this={composerEl}
        placeholder="Écrire un message…"
        on:keydown={handleKeyDown}
      ></textarea>
      <button
        class="rounded bg-blue-600 hover:bg-blue-700 text-white w-10 h-10 flex items-center justify-center disabled:opacity-60"
        on:click={() => void sendMessage()}
        disabled={sending || input.trim().length === 0}
        type="button"
        aria-label="Envoyer"
      >
        <Send class="w-4 h-4" />
      </button>
    </div>
  </div>
</div>
