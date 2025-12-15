<script lang="ts">
  import { afterUpdate, onMount, tick } from 'svelte';
  import { apiGet, apiPost, apiDelete, ApiError } from '$lib/utils/api';
  import StreamMessage from '$lib/components/StreamMessage.svelte';

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
  let pendingScrollToBottom = false;
  let scrollToBottomInFlight = false;

  // Historique batch (Option C): messageId -> events
  let initialEventsByMessageId = new Map<string, StreamEvent[]>();
  let streamDetailsLoading = false;
  const terminalRefreshInFlight = new Set<string>();

  const requestScrollToBottom = () => {
    pendingScrollToBottom = true;
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

  // Exécuter le scroll UNIQUEMENT quand on l'a explicitement demandé (load/switch/stream),
  // pas sur des updates DOM ordinaires (ex: ouverture d'un chevron).
  afterUpdate(() => {
    if (!pendingScrollToBottom) return;
    if (scrollToBottomInFlight) return;
    pendingScrollToBottom = false;
    scrollToBottomInFlight = true;
    void (async () => {
      try {
        await scrollChatToBottomStable();
      } finally {
        scrollToBottomInFlight = false;
      }
    })();
  });

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

  const loadMessages = async (id: string, opts?: { scrollToBottom?: boolean }) => {
    loadingMessages = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessionId: string; messages: ChatMessage[] }>(`/chat/sessions/${id}/messages`);
      const raw = res.messages ?? [];
      messages = raw.map((m) => ({
        ...m,
        _streamId: m.id,
        _localStatus: m.content ? 'completed' : undefined
      }));
      if (opts?.scrollToBottom !== false) requestScrollToBottom();

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
      loadingMessages = false;
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
    requestScrollToBottom();
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
    if (sessionId) await loadMessages(sessionId, { scrollToBottom: true });
    requestScrollToBottom();
    // Laisser le temps à la UI de se stabiliser avant d'autoriser un autre refresh (évite boucles sur replay).
    await tick();
    terminalRefreshInFlight.delete(streamId);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    sending = true;
    errorMsg = null;
    try {
      const res = await apiPost<{
        sessionId: string;
        userMessageId: string;
        assistantMessageId: string;
        streamId: string;
        jobId: string;
      }>(
        '/chat/messages',
        sessionId ? { sessionId, content: text } : { content: text }
      );

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
      requestScrollToBottom();
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de l’envoi');
    } finally {
      sending = false;
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
    class="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 chat-scroll"
    style="scrollbar-gutter: stable;"
    bind:this={listEl}
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
          <div class="flex justify-start">
            <div class="max-w-[85%] w-full">
              <StreamMessage
                variant="chat"
                streamId={sid}
                status={m._localStatus ?? (m.content ? 'completed' : 'processing')}
                finalContent={m.content ?? null}
                initialEvents={initEvents}
                historyPending={showDetailWaiter}
                onStreamEvent={() => requestScrollToBottom()}
                onTerminal={(t) => void handleAssistantTerminal(sid, t)}
              />
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
        placeholder="Écrire un message…"
        on:keydown={(e) => {
          if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
            e.preventDefault();
            void sendMessage();
          }
        }}
      ></textarea>
      <button
        class="rounded bg-blue-600 hover:bg-blue-700 text-white w-10 h-10 flex items-center justify-center disabled:opacity-60"
        on:click={() => void sendMessage()}
        disabled={sending || input.trim().length === 0}
        type="button"
        aria-label="Envoyer"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l11-11m0 0l-3 20-8-9-9-8 20-3z" />
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  /* Scrollbar slim (alignée StreamMessage) */
  .chat-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(15, 23, 42, 0.28) transparent;
  }
  .chat-scroll::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .chat-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .chat-scroll::-webkit-scrollbar-thumb {
    background-color: rgba(15, 23, 42, 0.22);
    border-radius: 999px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
  .chat-scroll:hover::-webkit-scrollbar-thumb {
    background-color: rgba(15, 23, 42, 0.32);
  }
</style>


