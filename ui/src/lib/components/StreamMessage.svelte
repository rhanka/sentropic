<script lang="ts">
  import { onDestroy } from 'svelte';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';
  import { apiGet } from '$lib/utils/api';

  export let streamId: string;
  export let status: string | undefined;
  export let maxHistory = 10;
  export let initiallyExpanded = false;
  export let placeholderTitle: string | undefined = undefined;
  export let placeholderBody: string | undefined = undefined;

  // Nouveau: variantes
  export let variant: 'chat' | 'job' = 'job';
  export let finalContent: string | null | undefined = undefined; // chat: contenu final (bulle)
  export let initialEvents:
    | Array<{ eventType: string; data: unknown; sequence: number; createdAt?: string }>
    | undefined = undefined;
  export let historySource: 'none' | 'stream' | 'chat' = 'none';
  export let historyLimit = 2000;
  export let historyPending: boolean = false;
  // eslint-disable-next-line no-unused-vars
  export let onTerminal: ((t: 'done' | 'error') => void) | undefined = undefined;
  // eslint-disable-next-line no-unused-vars
  export let onStreamEvent: ((t: string) => void) | undefined = undefined;

  type Step = { title: string; body?: string };
  type State = {
    startedAtMs: number;
    endedAtMs?: number | null;
    stepTitle: string;
    auxText: string;
    contentText: string;
    toolArgsById: Record<string, string>;
    toolNameById: Record<string, string>;
    toolCallIds: Set<string>;
    sawReasoning: boolean;
    sawTools: boolean;
    sawStarted: boolean;
    steps: Step[];
    expanded: boolean;
    lastSeq: number;
  };

  let st: State = {
    startedAtMs: Date.now(),
    endedAtMs: null,
    stepTitle: 'En cours…',
    auxText: '',
    contentText: '',
    toolArgsById: {},
    toolNameById: {},
    toolCallIds: new Set<string>(),
    sawReasoning: false,
    sawTools: false,
    sawStarted: false,
    steps: [],
    expanded: initiallyExpanded,
    lastSeq: 0
  };

  let terminalNotified = false;

  let detailLoading = false;
  let detailLoaded = false;
  let lastInitialEventsRef: unknown = null;

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

  const isTerminalStatus = (s?: string) => s === 'completed' || s === 'failed' || s === 'done';

  // Limite d'historique: sur les cartes/jobs on veut souvent un historique court,
  // tandis que sur le chat on garde davantage d'étapes.
  $: stepLimit = variant === 'job' ? Math.max(1, maxHistory) : 30;

  const upsertStep = (title: string, body?: string) => {
    const last = st.steps[st.steps.length - 1];
    if (last && last.title === title) {
      last.body = body;
      st.steps = [...st.steps];
      return;
    }
    st.steps = [...st.steps, { title, body }].slice(-stepLimit);
  };

  const applyEvent = (eventType: string, data: any, sequence: number, createdAt?: string) => {
    if (!Number.isFinite(sequence)) return;
    if (sequence <= st.lastSeq) return;
    st.lastSeq = sequence;

    const t = createdAt ? Date.parse(createdAt) : NaN;
    const ts = Number.isFinite(t) ? t : Date.now();

    if (eventType === 'status') {
      const state = String(data?.state ?? 'unknown');
      if (state === 'started') {
        st.sawStarted = true;
        // Option B: libellé explicite pour la phase de démarrage
        st.stepTitle = 'Préparation…';
        st.startedAtMs = ts;
      } else {
        st.stepTitle = `Statut: ${state}`;
      }
    } else if (eventType === 'reasoning_delta') {
      st.sawReasoning = true;
      st.sawStarted = false;
      st.stepTitle = 'Raisonnement';
      const delta = String(data?.delta ?? '');
      st.auxText = (st.auxText || '') + delta;
      upsertStep('Raisonnement', st.auxText);
    } else if (eventType === 'tool_call_start') {
      st.sawTools = true;
      st.sawStarted = false;
      const name = String(data?.name ?? 'unknown');
      st.stepTitle = `Outil: ${name}`;
      const toolId = String(data?.tool_call_id ?? '').trim();
      if (toolId) st.toolCallIds.add(toolId);
      if (toolId && name && name !== 'unknown') st.toolNameById[toolId] = name;
      const args = String(data?.args ?? '').trim();
      if (args) st.auxText = args;
      upsertStep(`Outil: ${name}`, args || undefined);
    } else if (eventType === 'tool_call_delta') {
      st.sawTools = true;
      st.sawStarted = false;
      const toolId = String(data?.tool_call_id ?? '').trim() || 'unknown';
      const delta = String(data?.delta ?? '');
      if (toolId && toolId !== 'unknown') st.toolCallIds.add(toolId);
      st.toolArgsById[toolId] = (st.toolArgsById[toolId] ?? '') + delta;
      const toolName = st.toolNameById[toolId];
      st.stepTitle = toolName ? `Outil: ${toolName} (args)` : 'Outil (args)';
      st.auxText = st.toolArgsById[toolId];
      upsertStep(`Outil: ${toolName || toolId} (args)`, st.auxText);
    } else if (eventType === 'tool_call_result') {
      st.sawTools = true;
      st.sawStarted = false;
      const status = String(data?.result?.status ?? (data?.result ? 'completed' : 'unknown'));
      const err = data?.result?.error;
      const toolId = String(data?.tool_call_id ?? '').trim();
      const toolName = toolId ? st.toolNameById[toolId] : undefined;
      const label = toolName ? `${toolName} (${err ? 'error' : status})` : (err ? 'erreur' : status);
      st.stepTitle = `Outil: ${label}`;
      if (err) st.auxText = String(err);
      upsertStep(`Outil: ${label}`, err ? String(err) : undefined);
    } else if (eventType === 'content_delta') {
      st.sawStarted = false;
      st.stepTitle = 'Réponse';
      const delta = String(data?.delta ?? '');
      st.contentText = (st.contentText || '') + delta;
    } else if (eventType === 'done' || eventType === 'error') {
      st.endedAtMs = ts;
      st.stepTitle = eventType === 'done' ? 'Terminé' : 'Erreur';
      if (eventType === 'error') st.auxText = String(data?.message ?? 'unknown');
    }
  };

  const applyEvents = (events: Array<{ eventType: string; data: any; sequence: number; createdAt?: string }>) => {
    for (const ev of events) {
      applyEvent(ev.eventType, ev.data, ev.sequence, ev.createdAt);
    }
    // trigger rerender for Set/Record updates
    st = { ...st, toolCallIds: new Set(st.toolCallIds), toolArgsById: { ...st.toolArgsById }, toolNameById: { ...st.toolNameById }, steps: [...st.steps] };
  };

  const hydrateHistory = async () => {
    if (!streamId) return;
    if (initialEvents && initialEvents.length > 0) {
      applyEvents(initialEvents as any);
      detailLoaded = true;
      return;
    }
    if (historySource === 'none') return;
    try {
      detailLoading = true;
      if (historySource === 'stream') {
        const res = await apiGet<{ streamId: string; events: Array<{ eventType: string; data: any; sequence: number; createdAt?: string }> }>(
          `/streams/events/${encodeURIComponent(streamId)}?limit=${historyLimit}`
        );
        applyEvents((res as any)?.events ?? []);
      } else if (historySource === 'chat') {
        const res = await apiGet<{ messageId: string; streamId: string; events: Array<{ eventType: string; data: any; sequence: number; createdAt?: string }> }>(
          `/chat/messages/${encodeURIComponent(streamId)}/stream-events?limit=${historyLimit}`
        );
        applyEvents((res as any)?.events ?? []);
      }
      detailLoaded = true;
    } catch {
      // ignore
    } finally {
      detailLoading = false;
    }
  };

  const makeKey = () => `streamMessage2:${streamId}:${Math.random().toString(36).slice(2)}`;
  let subKey = makeKey();
  let subscribedTo: string | null = null;

  const handle = async (evt: StreamHubEvent) => {
    if (!streamId) return;
    if ((evt as any).streamId !== streamId) return;
    const type = (evt as any).type as string;
    const sequence = (evt as any).sequence as number;
    const data = (evt as any).data ?? {};

    applyEvent(type, data, sequence);
    st = { ...st, toolCallIds: new Set(st.toolCallIds), toolArgsById: { ...st.toolArgsById }, steps: [...st.steps] };

    // callback parent pour scroll (uniquement sur events)
    onStreamEvent?.(type);

    if (type === 'done' || type === 'error') {
      // Éviter les boucles: si on a déjà le contenu final (chat rehydraté), on ne notifie pas.
      // De même, on ne notifie qu'une seule fois par instance.
      if (!terminalNotified && !(variant === 'chat' && !!finalContent)) {
        terminalNotified = true;
        onTerminal?.(type);
      }
    }
  };

  const subscribe = async (id: string) => {
    if (!id) return;
    subKey = makeKey();
    subscribedTo = id;
    streamHub.setStream(subKey, id, handle);
    // Hydratation non bloquante : on affiche tout de suite, puis on charge le détail
    void hydrateHistory();
  };

  const unsubscribe = () => {
    if (!subscribedTo) return;
    streamHub.delete(subKey);
    subscribedTo = null;
  };

  const reset = () => {
    st = {
      startedAtMs: Date.now(),
      endedAtMs: null,
      stepTitle: 'En cours…',
      auxText: '',
      contentText: '',
      toolArgsById: {},
      toolNameById: {},
      toolCallIds: new Set<string>(),
      sawReasoning: false,
      sawTools: false,
      sawStarted: false,
      steps: [],
      expanded: initiallyExpanded,
      lastSeq: 0
    };
    detailLoading = false;
    detailLoaded = false;
    lastInitialEventsRef = null;
    terminalNotified = false;
  };

  $: if (streamId && streamId !== subscribedTo) {
    unsubscribe();
    reset();
    void subscribe(streamId);
  }

  onDestroy(() => {
    unsubscribe();
  });

  $: hasSteps = st.sawReasoning || st.sawTools;
  $: hasContent = !!st.contentText && st.contentText.trim().length > 0;
  $: showStartup = !!st.sawStarted && !hasSteps && !hasContent && !finalContent;
  $: toolsCount = st.toolCallIds.size;
  $: durationMs = (st.endedAtMs ?? Date.now()) - st.startedAtMs;
  // "Chargement du détail…" est un waiter UX pour le chat (détail tools/reasoning d'un message déjà finalisé),
  // mais il n'a pas de sens pour les jobs (sinon on voit le waiter pendant les états pending).
  $: showDetailLoader =
    variant === 'chat' &&
    (historyPending || detailLoading) &&
    !detailLoaded &&
    !hasSteps &&
    !showStartup &&
    !!finalContent;

  // Si le parent injecte les events après coup (batch), on les applique sans re-fetch
  $: if (initialEvents && initialEvents !== lastInitialEventsRef) {
    lastInitialEventsRef = initialEvents;
    if (initialEvents.length > 0) applyEvents(initialEvents as any);
    detailLoaded = true;
    detailLoading = false;
  }
</script>

<div class="w-full max-w-full">
    {#if showDetailLoader}
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <div class="text-[11px] text-slate-500">Chargement du détail…</div>
        <!-- Réserver exactement la même hauteur/largeur que le chevron, sans interaction -->
        <button
          class="text-slate-500 p-1 rounded opacity-0 pointer-events-none shrink-0"
          type="button"
          tabindex="-1"
          aria-hidden="true"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    {/if}
    {#if hasSteps && (hasContent || !!finalContent || (variant === 'job' && isTerminalStatus(status)))}
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <div class="text-[11px] text-slate-500">
          {#if st.sawReasoning}Raisonnement {Math.max(0, Math.floor(durationMs / 60000))}m{String(Math.max(0, Math.floor(durationMs / 1000)) % 60).padStart(2, '0')}s{/if}
          {#if st.sawReasoning && toolsCount > 0}, {/if}
          {#if toolsCount > 0}{toolsCount} appel{toolsCount > 1 ? 's' : ''} outil{toolsCount > 1 ? 's' : ''}{/if}
        </div>
        <button
          class="text-slate-500 hover:text-slate-700 p-1 rounded hover:bg-slate-100 shrink-0"
          type="button"
          aria-label={st.expanded ? 'Replier le détail' : 'Déplier le détail'}
          on:click={() => st = { ...st, expanded: !st.expanded }}
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
                  <div class="mt-0.5 text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto slim-scroll" use:scrollToEnd>
                    {step.body}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

    {#if variant === 'chat'}
      {#if finalContent}
        <div class="rounded bg-white border border-slate-200 text-xs px-3 py-2 whitespace-pre-wrap break-words text-slate-900">
          {finalContent}
        </div>
      {:else if hasContent}
        <div class="rounded bg-white border border-slate-200 text-xs px-3 py-2 whitespace-pre-wrap break-words text-slate-900">
          {st.contentText}
        </div>
      {:else}
        {#if showStartup}
          <div class="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
            <svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            <span>En cours…</span>
          </div>
        {/if}
        {#if hasSteps && !hasContent}
          <div class="text-[11px] text-slate-500">Étape en cours: {st.stepTitle ?? 'En cours…'}</div>
          {#if st.auxText}
            <div class="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto slim-scroll" use:scrollToEnd>
              {st.auxText}
            </div>
          {/if}
        {/if}
      {/if}
    {:else}
      <!-- job -->
      {#if !showStartup && !hasSteps && !isTerminalStatus(status) && (placeholderTitle || placeholderBody)}
        <div class="text-[11px] text-slate-500 mt-0.5">{placeholderTitle ?? 'En cours…'}</div>
        {#if placeholderBody}
          <div class="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto slim-scroll" use:scrollToEnd>
            {placeholderBody}
          </div>
        {/if}
      {/if}
      {#if showStartup}
        <div class="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
          <svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
          <span>En cours…</span>
        </div>
      {/if}
      {#if hasSteps && !isTerminalStatus(status)}
        <div class="text-[11px] text-slate-500">Étape en cours: {st.stepTitle ?? 'En cours…'}</div>
        {#if st.auxText}
          <div class="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto slim-scroll" use:scrollToEnd>
            {st.auxText}
          </div>
        {/if}
      {/if}
    {/if}
  </div>

