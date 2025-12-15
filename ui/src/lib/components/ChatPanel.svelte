<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { apiGet, apiPost, apiDelete, ApiError } from '$lib/utils/api';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';

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

  export let sessions: ChatSession[] = [];
  export let sessionId: string | null = null;
  let messages: LocalMessage[] = [];
  export let loadingSessions = false;
  let loadingMessages = false;
  let sending = false;
  let errorMsg: string | null = null;
  let input = '';

  const subKeysByStreamId = new Map<string, string>();
  type StreamStep = { title: string; body?: string };
  type StreamState = {
    startedAtMs: number;
    endedAtMs?: number | null;
    stepTitle: string;
    auxText: string; // reasoning/tools (gris clair)
    contentText: string; // réponse streamée dans bulle
    toolArgsById: Record<string, string>;
    toolCallIds: Set<string>;
    sawReasoning: boolean;
    sawTools: boolean;
    sawStarted: boolean;
    steps: StreamStep[]; // historique reasoning/tools (sans résultat)
    expanded: boolean; // détail étapes
  };

  let streamStateById = new Map<string, StreamState>();
  const hydratedStreamIds = new Set<string>();
  let listEl: HTMLDivElement | null = null;

  const scrollToEnd = (node: HTMLElement) => {
    const scroll = () => {
      try {
        node.scrollTop = node.scrollHeight;
      } catch {
        // ignore
      }
    };
    scroll();
    const obs = new MutationObserver(scroll);
    obs.observe(node, { childList: true, subtree: true, characterData: true });
    return {
      destroy() {
        obs.disconnect();
      }
    };
  };

  const scrollChatToBottom = async () => {
    await tick();
    if (!listEl) return;
    try {
      listEl.scrollTop = listEl.scrollHeight;
    } catch {
      // ignore
    }
  };

  const formatDuration = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return `${m}m${ss}s`;
  };

  const upsertStep = (state: StreamState, title: string, body?: string) => {
    const last = state.steps[state.steps.length - 1];
    if (last && last.title === title) {
      last.body = body;
      return;
    }
    state.steps.push({ title, body });
    if (state.steps.length > 30) state.steps = state.steps.slice(-30);
  };

  type StreamEvent = {
    eventType: string;
    data: any;
    sequence: number;
    createdAt?: string;
  };

  const buildStateFromEvents = (streamId: string, events: StreamEvent[]) => {
    if (!events.length) return;

    const startedEvent =
      events.find((e) => e.eventType === 'status' && String(e?.data?.state ?? '') === 'started') ?? events[0];
    const lastEvent = events[events.length - 1];
    const startedAtMs = startedEvent?.createdAt ? Date.parse(startedEvent.createdAt) : Date.now();
    const endedAtMs = lastEvent?.createdAt ? Date.parse(lastEvent.createdAt) : null;

    const existing = streamStateById.get(streamId);
    const st: StreamState = existing ?? {
      startedAtMs,
      endedAtMs,
      stepTitle: 'Terminé',
      auxText: '',
      contentText: '',
      toolArgsById: {},
      toolCallIds: new Set<string>(),
      sawReasoning: false,
      sawTools: false,
      sawStarted: false,
      steps: [],
      expanded: false
    };

    st.startedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : Date.now();
    st.endedAtMs = Number.isFinite(endedAtMs as number) ? (endedAtMs as number) : st.endedAtMs ?? null;

    for (const ev of events) {
      const type = ev.eventType;
      const data = ev.data ?? {};

      if (type === 'reasoning_delta') {
        st.sawReasoning = true;
        const delta = String(data?.delta ?? '');
        st.auxText = (st.auxText || '') + delta;
        upsertStep(st, 'Raisonnement', st.auxText);
      } else if (type === 'tool_call_start') {
        st.sawTools = true;
        const name = String(data?.name ?? 'unknown');
        const toolId = String(data?.tool_call_id ?? '').trim();
        if (toolId) st.toolCallIds.add(toolId);
        const args = String(data?.args ?? '').trim();
        upsertStep(st, `Outil: ${name}`, args || undefined);
      } else if (type === 'tool_call_delta') {
        st.sawTools = true;
        const toolId = String(data?.tool_call_id ?? '').trim() || 'unknown';
        const delta = String(data?.delta ?? '');
        if (toolId && toolId !== 'unknown') st.toolCallIds.add(toolId);
        st.toolArgsById[toolId] = (st.toolArgsById[toolId] ?? '') + delta;
        upsertStep(st, `Outil: ${toolId} (args)`, st.toolArgsById[toolId]);
      } else if (type === 'tool_call_result') {
        st.sawTools = true;
        const status = String(data?.result?.status ?? 'unknown');
        const err = data?.result?.error;
        upsertStep(st, `Outil: ${err ? 'erreur' : status}`, err ? String(err) : undefined);
      } else if (type === 'done' || type === 'error') {
        if (ev.createdAt) {
          const t = Date.parse(ev.createdAt);
          if (Number.isFinite(t)) st.endedAtMs = t;
        }
      }
    }

    streamStateById.set(streamId, st);
    streamStateById = new Map(streamStateById);
  };

  const hydrateHistoryForMessages = async (sessionIdForCall: string, msgs: LocalMessage[]) => {
    // On ne rehydrate que les messages assistant "finalisés", et on limite pour éviter N requêtes énormes
    const assistants = msgs.filter((m) => m.role === 'assistant' && !!m.content);
    const slice = assistants.slice(-20);
    for (const m of slice) {
      const sid = m._streamId ?? m.id;
      if (!sid || hydratedStreamIds.has(sid)) continue;
      hydratedStreamIds.add(sid);
      try {
        const res = await apiGet<{ messageId: string; streamId: string; events: StreamEvent[] }>(
          `/chat/messages/${sid}/stream-events?limit=2000`
        );
        // Si l'utilisateur a changé de session entre temps, on ignore
        if (sessionId !== sessionIdForCall) continue;
        const events = (res as any)?.events ?? [];
        buildStateFromEvents(sid, events);
      } catch {
        // ignore
      }
    }
  };

  const toggleExpanded = (streamId: string) => {
    const st = streamStateById.get(streamId);
    if (!st) return;
    st.expanded = !st.expanded;
    streamStateById.set(streamId, st);
    streamStateById = new Map(streamStateById);
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

  const loadMessages = async (id: string, opts?: { scrollToBottom?: boolean }) => {
    loadingMessages = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessionId: string; messages: ChatMessage[] }>(`/chat/sessions/${id}/messages`);
      const raw = res.messages ?? [];
      // Garder un streamId cohérent pour le rendu (chat: streamId == assistantMessageId)
      messages = raw.map((m) => ({
        ...m,
        _streamId: m.id,
        _localStatus: m.content ? 'completed' : undefined
      }));
      void hydrateHistoryForMessages(id, messages);
      if (opts?.scrollToBottom) await scrollChatToBottom();
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors du chargement des messages');
    } finally {
      loadingMessages = false;
    }
  };

  export const selectSession = async (id: string) => {
    sessionId = id;
    // Ouverture/switch session => on va à la fin
    await loadMessages(id, { scrollToBottom: true });
  };

  export const newSession = () => {
    sessionId = null;
    messages = [];
    errorMsg = null;
    // On garde la liste des sessions; la nouvelle session sera créée au 1er envoi
    void scrollChatToBottom();
  };

  export const deleteCurrentSession = async () => {
    if (!sessionId) return;
    if (!confirm('Supprimer cette conversation ?')) return;
    errorMsg = null;
    try {
      await apiDelete(`/chat/sessions/${sessionId}`);
      sessionId = null;
      messages = [];
      await loadSessions();
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de la suppression de la session');
    }
  };

  const subscribeToStream = (streamId: string) => {
    if (subKeysByStreamId.has(streamId)) return;
    const key = `chatPanel:${streamId}:${Math.random().toString(36).slice(2)}`;
    subKeysByStreamId.set(streamId, key);

    // Initialiser un état (permet d'afficher l'étape dès qu'on a au moins un signal)
    if (!streamStateById.has(streamId)) {
      const now = Date.now();
      streamStateById.set(streamId, {
        startedAtMs: now,
        stepTitle: 'En cours…',
        auxText: '',
        contentText: '',
        toolArgsById: {},
        toolCallIds: new Set<string>(),
        sawReasoning: false,
        sawTools: false,
        sawStarted: false,
        steps: [],
        expanded: false
      });
      streamStateById = new Map(streamStateById);
    }

    streamHub.setStream(key, streamId, async (evt: StreamHubEvent) => {
      const type = (evt as any)?.type as string;
      const data = (evt as any)?.data ?? {};
      const now = Date.now();
      const current: StreamState =
        streamStateById.get(streamId) ?? {
          startedAtMs: now,
          stepTitle: 'En cours…',
          auxText: '',
          contentText: '',
          toolArgsById: {},
          toolCallIds: new Set<string>(),
          sawReasoning: false,
          sawTools: false,
          sawStarted: false,
          steps: [],
          expanded: false
        };

      if (type === 'status') {
        const st = String(data?.state ?? 'unknown');
        if (st === 'started') {
          current.sawStarted = true;
          current.stepTitle = '…';
        } else {
          current.stepTitle = `Statut: ${st}`;
        }
      } else if (type === 'reasoning_delta') {
        current.stepTitle = 'Raisonnement';
        const delta = String(data?.delta ?? '');
        current.sawReasoning = true;
        current.sawStarted = false;
        current.auxText = (current.auxText || '') + delta;
        upsertStep(current, 'Raisonnement', current.auxText);
      } else if (type === 'tool_call_start') {
        const name = String(data?.name ?? 'unknown');
        current.stepTitle = `Outil: ${name}`;
        current.sawTools = true;
        current.sawStarted = false;
        const toolId = String(data?.tool_call_id ?? '').trim();
        if (toolId) current.toolCallIds.add(toolId);
        const args = String(data?.args ?? '').trim();
        if (args) current.auxText = args;
        upsertStep(current, `Outil: ${name}`, args || undefined);
      } else if (type === 'tool_call_delta') {
        const toolId = String(data?.tool_call_id ?? '').trim() || 'unknown';
        const delta = String(data?.delta ?? '');
        current.sawTools = true;
        current.sawStarted = false;
        if (toolId && toolId !== 'unknown') current.toolCallIds.add(toolId);
        current.toolArgsById[toolId] = (current.toolArgsById[toolId] ?? '') + delta;
        current.stepTitle = 'Outil (args)';
        current.auxText = current.toolArgsById[toolId];
        upsertStep(current, `Outil: ${toolId} (args)`, current.auxText);
      } else if (type === 'tool_call_result') {
        const st = data?.result?.status ?? 'unknown';
        const err = data?.result?.error;
        current.stepTitle = err ? 'Outil: erreur' : `Outil: ${st}`;
        if (err) current.auxText = String(err);
        current.sawTools = true;
        current.sawStarted = false;
        upsertStep(current, `Outil: ${err ? 'erreur' : st}`, err ? String(err) : undefined);
      } else if (type === 'content_delta') {
        current.stepTitle = 'Réponse';
        const delta = String(data?.delta ?? '');
        current.sawStarted = false;
        current.contentText = (current.contentText || '') + delta;
      }

      streamStateById.set(streamId, current);
      // trigger re-render
      streamStateById = new Map(streamStateById);

      await scrollChatToBottom();

      if (type !== 'done' && type !== 'error') return;

      current.endedAtMs = now;
      // Marquer localement + re-fetch pour récupérer le content final
      messages = messages.map((m) =>
        (m._streamId ?? m.id) === streamId ? { ...m, _localStatus: type === 'done' ? 'completed' : 'failed' } : m
      );

      if (sessionId) await loadMessages(sessionId);
      // Important: garder le scroll en bas quand le résultat final remplace le stream
      await scrollChatToBottom();

      // Unsubscribe: on n'a plus besoin du flux une fois terminé
      const k = subKeysByStreamId.get(streamId);
      if (k) {
        streamHub.delete(k);
        subKeysByStreamId.delete(streamId);
      }
    });
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
        // refresh sessions list (nouvelle session)
        void loadSessions();
      }

      // Optimistic append (UI instantanée)
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

      // Subscribe au stream pour refresh à la fin
      subscribeToStream(res.streamId);
      await scrollChatToBottom();
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de l’envoi');
    } finally {
      sending = false;
    }
  };

  onMount(async () => {
    await loadSessions();
    // Si le parent a déjà sélectionné une session (ex: retour depuis Jobs IA / réouverture widget),
    // on recharge son contenu au montage.
    if (sessionId && messages.length === 0) {
      await loadMessages(sessionId, { scrollToBottom: true });
    }
  });

  onDestroy(() => {
    for (const key of subKeysByStreamId.values()) streamHub.delete(key);
    subKeysByStreamId.clear();
  });
</script>

<div class="flex flex-col max-h-80">

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
          {@const st = streamStateById.get(sid)}
          {@const hasSteps = !!st && (st.sawReasoning || st.sawTools)}
          {@const hasContent = !!st?.contentText && st.contentText.trim().length > 0}
          {@const showStartup = !!st?.sawStarted && !hasContent && !hasSteps}
          <div class="flex justify-start">
            <div class="max-w-[85%] w-full">

              <!-- Chevron uniquement quand on a commencé à streamer la réponse (ou résultat final) -->
              {#if hasSteps && (hasContent || !!m.content)}
                {@const duration = formatDuration((st.endedAtMs ?? Date.now()) - st.startedAtMs)}
                {@const toolsCount = st.toolCallIds.size}
                <div class="flex items-center justify-between gap-2 mt-0.5">
                  <div class="text-[11px] text-slate-500">
                    {#if st.sawReasoning}Raisonnement {duration}{/if}
                    {#if st.sawReasoning && toolsCount > 0}, {/if}
                    {#if toolsCount > 0}{toolsCount} appel{toolsCount > 1 ? 's' : ''} outil{toolsCount > 1 ? 's' : ''}{/if}
                  </div>
                  <button
                    class="text-slate-500 hover:text-slate-700 p-1 rounded hover:bg-slate-100 shrink-0"
                    type="button"
                    aria-label={st.expanded ? 'Replier le détail' : 'Déplier le détail'}
                    on:click={() => toggleExpanded(sid)}
                  >
                    <svg
                      class="w-4 h-4 transition-transform duration-150 {st.expanded ? 'rotate-180' : ''}"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {#if st.expanded}
                  <div class="mt-1 bg-transparent border border-slate-100 rounded p-2">
                    <ul class="space-y-2">
                      {#each st.steps as step, i (i)}
                        <li class="text-[11px] text-slate-600">
                          <div class="font-medium text-slate-600">{step.title}</div>
                          {#if step.body}
                            <div class="mt-0.5 text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto chat-scroll" use:scrollToEnd>
                              {step.body}
                            </div>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              {/if}

              {#if m.content}
                <div class="rounded bg-white border border-slate-200 text-xs px-3 py-2 whitespace-pre-wrap break-words text-slate-900">
                  {m.content}
                </div>
              {:else}
                <!-- Si pas de contenu streamé, on n'affiche pas la bulle de réponse.
                     On montre uniquement l'étape en cours (raisonnement/outils) quand elle existe. -->
                {#if showStartup}
                  <div class="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                    <span>En cours…</span>
                  </div>
                {/if}
                {#if hasSteps && !hasContent}
                  <div class="text-[11px] text-slate-500">
                    Étape en cours: {st?.stepTitle ?? 'En cours…'}
                  </div>
                  {#if st?.auxText}
                    <div class="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto chat-scroll" use:scrollToEnd>
                      {st.auxText}
                    </div>
                  {/if}
                {/if}

                {#if hasContent}
                  <div class="mt-2 rounded bg-white border border-slate-200 text-xs px-3 py-2 whitespace-pre-wrap break-words text-slate-900">
                    {st.contentText}
                  </div>
                {/if}
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


