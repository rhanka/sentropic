<script lang="ts">
  import { onDestroy } from 'svelte';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';
  import { apiGet } from '$lib/utils/api';
  import { ChevronDown, Loader2 } from '@lucide/svelte';
  import { Streamdown } from 'svelte-streamdown';
  import { _ } from 'svelte-i18n';

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
  export let smoothContentStreaming = false;
  export let smoothChunkThreshold = 80;
  // eslint-disable-next-line no-unused-vars
  export let onTerminal: ((t: 'done' | 'error') => void) | undefined = undefined;
  // eslint-disable-next-line no-unused-vars
  export let onStreamEvent: ((t: string) => void) | undefined = undefined;

  type Step = { title: string; body?: string; kind?: 'reasoning' | 'tool' | 'status' | 'content' | 'startup' | 'other' };
  type TodoToolTask = {
    id?: string;
    title: string;
  };
  type TodoToolCard = {
    toolCallId: string;
    status: string;
    planId: string | null;
    todoId: string;
    taskCount: number;
    tasks: TodoToolTask[];
  };
  type State = {
    startedAtMs: number;
    endedAtMs?: number | null;
    stepTitle: string;
    stepKind: Step['kind'];
    auxText: string;
    contentText: string;
    toolArgsById: Record<string, string>;
    toolNameById: Record<string, string>;
    toolCallIds: Set<string>;
    sawReasoning: boolean;
    sawTools: boolean;
    sawStarted: boolean;
    steps: Step[];
    todoCards: TodoToolCard[];
    expanded: boolean;
    lastSeq: number;
  };

  let st: State = {
    startedAtMs: Date.now(),
    endedAtMs: null,
    stepTitle: '',
    stepKind: 'other',
    auxText: '',
    contentText: '',
    toolArgsById: {},
    toolNameById: {},
    toolCallIds: new Set<string>(),
    sawReasoning: false,
    sawTools: false,
    sawStarted: false,
    steps: [],
    todoCards: [],
    expanded: initiallyExpanded,
    lastSeq: 0
  };

  let terminalNotified = false;

  let detailLoading = false;
  let detailLoaded = false;
  let lastInitialEventsRef: unknown = null;
  let smoothedContentText = '';
  let smoothPendingText = '';
  let smoothTimer: ReturnType<typeof setTimeout> | null = null;

  // Chat bubble: keep a single DOM subtree and only update the content prop.
  // This avoids a visual "blink" when switching from streamed markdown to final persisted markdown.
  $: finalText = typeof finalContent === 'string' ? finalContent : '';
  $: streamedDisplayContent = smoothContentStreaming
    ? smoothedContentText
    : (st.contentText || '');
  $: displayContent = finalText.trim().length > 0 ? finalText : streamedDisplayContent;

  const cancelSmoothTimer = () => {
    if (smoothTimer) {
      clearTimeout(smoothTimer);
      smoothTimer = null;
    }
  };

  const smoothStepSize = (pendingLength: number): number => {
    if (pendingLength > 2400) return 48;
    if (pendingLength > 1200) return 32;
    if (pendingLength > 600) return 20;
    if (pendingLength > 240) return 12;
    return 6;
  };

  const runSmoothPump = () => {
    if (smoothTimer || !smoothPendingText) return;
    const tick = () => {
      if (!smoothPendingText) {
        smoothTimer = null;
        return;
      }
      const size = smoothStepSize(smoothPendingText.length);
      const next = smoothPendingText.slice(0, size);
      smoothPendingText = smoothPendingText.slice(size);
      smoothedContentText = `${smoothedContentText}${next}`;
      smoothTimer = setTimeout(tick, 18);
    };
    smoothTimer = setTimeout(tick, 0);
  };

  const pushSmoothedDelta = (delta: string) => {
    if (!delta) return;
    const shouldAnimate =
      delta.length >= smoothChunkThreshold ||
      smoothPendingText.length > 0 ||
      smoothTimer !== null;
    if (!shouldAnimate) {
      smoothedContentText = st.contentText || '';
      return;
    }
    smoothPendingText = `${smoothPendingText}${delta}`;
    runSmoothPump();
  };

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
    st.steps = [...st.steps, { title, body, kind: st.stepKind ?? 'other' }].slice(-stepLimit);
  };

  const needsReasoningSectionBreak = (prev: string, delta: string): boolean => {
    if (!prev) return false;
    if (!delta || !delta.startsWith('**')) return false;
    // Only insert a break if the previous content does not end with whitespace (space/tab/newline).
    return !/\s$/.test(prev);
  };

  const parseTodoToolCard = (
    toolCallId: string,
    rawResult: unknown,
  ): TodoToolCard | null => {
    if (!rawResult || typeof rawResult !== 'object') return null;
    const result = rawResult as Record<string, unknown>;
    const todoId = String(result.todoId ?? '').trim();
    if (!todoId) return null;

    const tasks = Array.isArray(result.tasks)
      ? result.tasks
          .map((entry): TodoToolTask | null => {
            const item =
              entry && typeof entry === 'object'
                ? (entry as Record<string, unknown>)
                : null;
            const title = String(item?.title ?? '').trim();
            if (!title) return null;
            const id = String(item?.id ?? '').trim();
            return id ? { id, title } : { title };
          })
          .filter((entry): entry is TodoToolTask => entry !== null)
      : [];

    return {
      toolCallId,
      status: String(result.status ?? 'completed'),
      planId: typeof result.planId === 'string' ? result.planId : null,
      todoId,
      taskCount:
        typeof result.taskCount === 'number' ? result.taskCount : tasks.length,
      tasks,
    };
  };

  const upsertTodoToolCard = (card: TodoToolCard) => {
    const existingIndex = st.todoCards.findIndex(
      (item) => item.toolCallId === card.toolCallId,
    );
    if (existingIndex === -1) {
      st.todoCards = [...st.todoCards, card];
      return;
    }
    st.todoCards[existingIndex] = card;
    st.todoCards = [...st.todoCards];
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
        st.stepKind = 'startup';
        st.stepTitle = $_('stream.preparing');
        st.startedAtMs = ts;
      } else if (state === 'reasoning_effort_selected') {
        const effort = String(data?.effort ?? '').trim() || 'unknown';
        const by = String(data?.by ?? '').trim();
        const label = by ? `${effort} (via ${by})` : effort;
        st.stepKind = 'reasoning';
        st.stepTitle = $_('stream.reasoningEffort');
        st.auxText = label;
        upsertStep(st.stepTitle, label);
      } else if (state === 'reasoning_effort') {
        const effort = String(data?.effort ?? '').trim() || 'unknown';
        const phase = String(data?.phase ?? '').trim();
        const it = data?.iteration != null ? String(data.iteration) : '';
        const label = `${effort}${phase ? ` — ${phase}${it ? ` #${it}` : ''}` : ''}`;
        st.stepKind = 'reasoning';
        st.stepTitle = $_('stream.reasoningEffort');
        st.auxText = label;
        upsertStep(st.stepTitle, label);
      } else if (state === 'reasoning_effort_eval_failed') {
        const msg = String(data?.message ?? '').trim() || $_('stream.unknownError');
        st.stepKind = 'reasoning';
        st.stepTitle = $_('stream.reasoningEffortFailed');
        st.auxText = msg;
        upsertStep(st.stepTitle, msg);
      } else {
        st.stepKind = 'status';
        st.stepTitle = $_('stream.status', { values: { state } });
      }
    } else if (eventType === 'reasoning_delta') {
      st.sawReasoning = true;
      st.sawStarted = false;
      st.stepKind = 'reasoning';
      st.stepTitle = $_('stream.reasoning');
      const delta = String(data?.delta ?? '');
      const prev = st.auxText || '';
      const sep = needsReasoningSectionBreak(prev, delta) ? '\n\n' : '';
      st.auxText = prev + sep + delta;
      upsertStep(st.stepTitle, st.auxText);
    } else if (eventType === 'tool_call_start') {
      st.sawTools = true;
      st.sawStarted = false;
      const name = String(data?.name ?? 'unknown');
      st.stepKind = 'tool';
      st.stepTitle = $_('stream.tool', { values: { name } });
      const toolId = String(data?.tool_call_id ?? '').trim();
      if (toolId) st.toolCallIds.add(toolId);
      if (toolId && name && name !== 'unknown') st.toolNameById[toolId] = name;
      const args = String(data?.args ?? '').trim();
      if (args) st.auxText = args;
      upsertStep(st.stepTitle, args || undefined);
    } else if (eventType === 'tool_call_delta') {
      st.sawTools = true;
      st.sawStarted = false;
      const toolId = String(data?.tool_call_id ?? '').trim() || 'unknown';
      const delta = String(data?.delta ?? '');
      if (toolId && toolId !== 'unknown') st.toolCallIds.add(toolId);
      st.toolArgsById[toolId] = (st.toolArgsById[toolId] ?? '') + delta;
      const toolName = st.toolNameById[toolId];
      st.stepKind = 'tool';
      st.stepTitle = toolName
        ? $_('stream.toolArgs', { values: { name: toolName } })
        : $_('stream.toolArgsFallback');
      st.auxText = st.toolArgsById[toolId];
      upsertStep(st.stepTitle, st.auxText);
    } else if (eventType === 'tool_call_result') {
      st.sawTools = true;
      st.sawStarted = false;
      const status = String(data?.result?.status ?? (data?.result ? 'completed' : 'unknown'));
      const err = data?.result?.error;
      const toolId = String(data?.tool_call_id ?? '').trim();
      const toolName = toolId ? st.toolNameById[toolId] : undefined;
      const label = toolName ? `${toolName} (${err ? 'error' : status})` : (err ? 'erreur' : status);
      st.stepKind = 'tool';
      st.stepTitle = $_('stream.tool', { values: { name: label } });
      if (err) st.auxText = String(err);
      upsertStep(st.stepTitle, err ? String(err) : undefined);
      if (toolId && toolName === 'todo_create') {
        const todoCard = parseTodoToolCard(toolId, data?.result);
        if (todoCard) {
          upsertTodoToolCard(todoCard);
        }
      }
    } else if (eventType === 'content_delta') {
      st.sawStarted = false;
      st.stepKind = 'content';
      st.stepTitle = $_('stream.response');
      const delta = String(data?.delta ?? '');
      st.contentText = (st.contentText || '') + delta;
      if (smoothContentStreaming && variant === 'chat') {
        pushSmoothedDelta(delta);
      } else {
        smoothPendingText = '';
        cancelSmoothTimer();
        smoothedContentText = st.contentText || '';
      }
    } else if (eventType === 'done' || eventType === 'error') {
      st.endedAtMs = ts;
      st.stepKind = eventType === 'done' ? 'content' : 'status';
      st.stepTitle = eventType === 'done' ? $_('stream.done') : $_('stream.error');
      if (eventType === 'error') st.auxText = String(data?.message ?? $_('stream.unknownError'));
      if (smoothPendingText) {
        smoothPendingText = '';
        cancelSmoothTimer();
        smoothedContentText = st.contentText || '';
      }
    }
  };

  const applyEvents = (events: Array<{ eventType: string; data: any; sequence: number; createdAt?: string }>) => {
    for (const ev of events) {
      applyEvent(ev.eventType, ev.data, ev.sequence, ev.createdAt);
    }
    // trigger rerender for Set/Record updates
    st = {
      ...st,
      toolCallIds: new Set(st.toolCallIds),
      toolArgsById: { ...st.toolArgsById },
      toolNameById: { ...st.toolNameById },
      steps: [...st.steps],
      todoCards: [...st.todoCards],
    };
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
    st = {
      ...st,
      toolCallIds: new Set(st.toolCallIds),
      toolArgsById: { ...st.toolArgsById },
      toolNameById: { ...st.toolNameById },
      steps: [...st.steps],
      todoCards: [...st.todoCards],
    };

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
    cancelSmoothTimer();
    st = {
      startedAtMs: Date.now(),
      endedAtMs: null,
      stepTitle: $_('stream.inProgress'),
      stepKind: 'other',
      auxText: '',
      contentText: '',
      toolArgsById: {},
      toolNameById: {},
      toolCallIds: new Set<string>(),
      sawReasoning: false,
      sawTools: false,
      sawStarted: false,
      steps: [],
      todoCards: [],
      expanded: initiallyExpanded,
      lastSeq: 0
    };
    smoothedContentText = '';
    smoothPendingText = '';
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
    cancelSmoothTimer();
    unsubscribe();
  });

  $: if (!smoothContentStreaming) {
    smoothPendingText = '';
    cancelSmoothTimer();
    smoothedContentText = st.contentText || '';
  }

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
        <div class="text-[11px] text-slate-500">{$_('stream.detailLoading')}</div>
        <!-- Réserver exactement la même hauteur/largeur que le chevron, sans interaction -->
        <button
          class="text-slate-500 p-1 rounded opacity-0 pointer-events-none shrink-0"
          type="button"
          tabindex="-1"
          aria-hidden="true"
        >
          <ChevronDown class="w-4 h-4" />
        </button>
      </div>
    {/if}
    {#if hasSteps && (hasContent || !!finalContent || (variant === 'job' && isTerminalStatus(status)))}
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <div class="text-[11px] text-slate-500">
          {#if st.sawReasoning}{$_('stream.reasoning')} {Math.max(0, Math.floor(durationMs / 60000))}m{String(Math.max(0, Math.floor(durationMs / 1000)) % 60).padStart(2, '0')}s{/if}
          {#if st.sawReasoning && toolsCount > 0}, {/if}
          {#if toolsCount > 0}{$_('stream.toolCalls', { values: { count: toolsCount } })}{/if}
        </div>
        <button
          class="text-slate-500 hover:text-slate-700 p-1 rounded hover:bg-slate-100 shrink-0"
          type="button"
          aria-label={st.expanded ? $_('stream.actions.collapseDetails') : $_('stream.actions.expandDetails')}
          on:click={() => st = { ...st, expanded: !st.expanded }}
        >
          <ChevronDown
            class="w-4 h-4 transition-transform duration-150 {st.expanded ? 'rotate-180' : ''}"
          />
        </button>
      </div>
      {#if st.expanded}
        <div class="mt-1 bg-transparent border border-slate-100 rounded p-2">
          <ul class="space-y-2">
            {#each st.steps as step, i (i)}
              <li class="text-[11px] text-slate-600">
                <div class="font-medium text-slate-600">{step.title}</div>
                {#if step.body}
                  <div
                    class="mt-0.5 text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto slim-scroll [&_*]:text-slate-400"
                    use:scrollToEnd
                  >
                    {#if step.kind === 'reasoning'}
                      <Streamdown content={step.body} />
                    {:else}
                      {step.body}
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

    {#if variant === 'chat'}
      {#if (finalText && finalText.trim().length > 0) || hasContent}
        <div class="chatMarkdown rounded bg-white border border-slate-200 text-xs px-3 py-2 break-words text-slate-900">
          <Streamdown content={displayContent} />
        </div>
      {:else}
        {#if showStartup}
          <div class="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            <span>{$_('stream.preparing')}</span>
          </div>
        {/if}
        {#if hasSteps && !hasContent}
          <div class="text-[11px] text-slate-500">{$_('stream.stepRunning', { values: { title: st.stepTitle || $_('stream.inProgress') } })}</div>
          {#if st.auxText}
            <div
              class="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto slim-scroll [&_*]:text-slate-400"
              use:scrollToEnd
            >
              {#if st.stepKind === 'reasoning'}
                <Streamdown content={st.auxText} />
              {:else}
                {st.auxText}
              {/if}
            </div>
          {/if}
        {/if}
      {/if}
      {#if st.todoCards.length > 0}
        <div class="mt-2 space-y-2">
          {#each st.todoCards as todoCard (todoCard.toolCallId)}
            <div class="rounded border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs text-emerald-900">
              <div class="font-semibold">{$_('chat.todoCard.title')}</div>
              <div class="mt-1 space-y-0.5">
                <div>
                  <span class="font-medium">{$_('chat.todoCard.statusLabel')}:</span>
                  {todoCard.status}
                </div>
                {#if todoCard.planId}
                  <div>
                    <span class="font-medium">{$_('chat.todoCard.planIdLabel')}:</span>
                    {todoCard.planId}
                  </div>
                {/if}
                <div>
                  <span class="font-medium">{$_('chat.todoCard.todoIdLabel')}:</span>
                  {todoCard.todoId}
                </div>
                <div>
                  <span class="font-medium">{$_('chat.todoCard.taskCountLabel')}:</span>
                  {todoCard.taskCount}
                </div>
              </div>
              {#if todoCard.tasks.length > 0}
                <div class="mt-2 font-medium">{$_('chat.todoCard.tasksLabel')}</div>
                <ul class="mt-1 space-y-1">
                  {#each todoCard.tasks as task, index (task.id ?? `${todoCard.toolCallId}-${index}`)}
                    <li class="flex items-start gap-2">
                      <span class="mt-0.5 inline-block h-3 w-3 rounded border border-emerald-500"></span>
                      <span>{task.title}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- job -->
      {#if !showStartup && !hasSteps && !isTerminalStatus(status) && (placeholderTitle || placeholderBody)}
        <div class="text-[11px] text-slate-500 mt-0.5">{placeholderTitle ?? $_('stream.inProgress')}</div>
        {#if placeholderBody}
          <div class="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto slim-scroll" use:scrollToEnd>
            {placeholderBody}
          </div>
        {/if}
      {/if}
      {#if showStartup}
        <div class="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
          <Loader2 class="w-3.5 h-3.5 animate-spin" />
          <span>{$_('stream.preparing')}</span>
        </div>
      {/if}
      {#if hasSteps && !isTerminalStatus(status)}
        <div class="text-[11px] text-slate-500">{$_('stream.stepRunning', { values: { title: st.stepTitle || $_('stream.inProgress') } })}</div>
        {#if st.auxText}
          <div class="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto slim-scroll" use:scrollToEnd>
            {st.auxText}
          </div>
        {/if}
      {/if}
    {/if}
  </div>

<style>
  /* Keep markdown headings compact inside chat bubbles (Streamdown default heading sizes are too large). */
  .chatMarkdown :global(h1) {
    font-size: 1.25rem;
    line-height: 1.25;
    margin: 0.4rem 0 0.25rem;
    font-weight: 700;
  }
  .chatMarkdown :global(h2) {
    font-size: 1rem;
    line-height: 1.25;
    margin: 0.35rem 0 0.2rem;
    font-weight: 700;
  }
  .chatMarkdown :global(h3) {
    font-size: 0.85rem;
    line-height: 1.3;
    margin: 0.3rem 0 0.15rem;
    font-weight: 700;
  }
  /* From H4 and below, keep the same size as body text (0.75rem). */
  .chatMarkdown :global(h4),
  .chatMarkdown :global(h5),
  .chatMarkdown :global(h6) {
    font-size: 0.75rem;
    line-height: 1.35;
    margin: 0.25rem 0 0.1rem;
    font-weight: 700;
  }

  /* Tables: Streamdown can render tables with a larger default size; force chat size (0.75rem). */
  .chatMarkdown :global(table),
  .chatMarkdown :global(th),
  .chatMarkdown :global(td) {
    font-size: 0.75rem;
    line-height: 1.25;
  }

  .chatMarkdown :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.35rem 0;
  }

  .chatMarkdown :global(th),
  .chatMarkdown :global(td) {
    padding: 0.2rem 0.35rem;
    vertical-align: top;
  }
</style>
