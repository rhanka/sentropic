<script lang="ts">
  import { onDestroy } from 'svelte';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';
  import { ChevronDown, Loader2 } from '@lucide/svelte';
  import { Streamdown } from 'svelte-streamdown';
  import { _ } from 'svelte-i18n';
  import type { GeneratedFileCard } from '$lib/utils/docx';

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
  export let historyPending: boolean = false;
  export let subscriptionMode: 'live' | 'passive' = 'live';
  export let smoothContentStreaming = false;
  export let smoothChunkThreshold = 80;
  export let acknowledgementText: string | undefined = undefined;
  export let showRuntimeInlinePreview = true;
  export let deferCollapsedDetails = false;
  export let requestDeferredDetails: (() => Promise<void>) | undefined = undefined;
  export let runtimeSummary:
    | {
        hasReasoning: boolean;
        hasTools: boolean;
        toolCount: number;
        contextBudgetPct: number | null;
        durationMs: number | null;
        reasoningEffortLabel: string | null;
        generatedFileCards?: GeneratedFileCard[];
        docxCards?: Array<{ jobId: string; fileName: string }>;
      }
    | undefined = undefined;
  // eslint-disable-next-line no-unused-vars
  export let onTerminal: ((t: 'done' | 'error') => void) | undefined = undefined;
  // eslint-disable-next-line no-unused-vars
  export let onStreamEvent: ((t: string) => void) | undefined = undefined;
  // eslint-disable-next-line no-unused-vars
  export let onGeneratedFile: ((card: GeneratedFileCard) => void) | undefined = undefined;
  // eslint-disable-next-line no-unused-vars
  export let onTodoRuntime:
    | ((
        update: {
          toolCallId: string;
          toolName: 'plan';
          result: Record<string, unknown>;
        },
      ) => void)
    | undefined = undefined;

  type Step = { title: string; body?: string; kind?: 'reasoning' | 'tool' | 'status' | 'content' | 'startup' | 'other' };
  type TodoToolTask = {
    id?: string;
    title: string;
    status?: string;
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
    contextBudgetPct: number | null;
    contextBudgetZone: 'normal' | 'soft' | 'hard';
    contextCompactionStrip: string;
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
    contextBudgetPct: null,
    contextBudgetZone: 'normal',
    contextCompactionStrip: '',
    expanded: initiallyExpanded,
    lastSeq: 0
  };

  let terminalNotified = false;

  let detailLoading = false;
  let detailLoaded = false;
  let detailHydrated = false;
  let detailDomMounted = false;
  let lastInitialEventsRef: unknown = null;
  let lastInitialEventCount = 0;
  let hasSteps = false;
  let hasContent = false;
  let hasAcknowledgement = false;
  let showStartup = false;
  let hasPassiveHistoryShell = false;
  let passiveHistoryShellHeading = '';
  let toolsCount = 0;
  let durationMs = 0;
  let showDetailLoader = false;
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
            const status = String(item?.status ?? item?.derivedStatus ?? '').trim();
            return id ? { id, title, status } : { title, status };
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

  const isTodoRuntimeToolName = (
    value: string | undefined,
  ): value is 'plan' => value === 'plan';

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };

  const normalizeTaskStatus = (value: unknown): string =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'todo';

  const asTaskList = (value: unknown): TodoToolTask[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry): TodoToolTask | null => {
        const item = asRecord(entry);
        if (!item) return null;
        const title = String(item.title ?? '').trim();
        if (!title) return null;
        const id = String(item.id ?? '').trim();
        const status = normalizeTaskStatus(item.status ?? item.derivedStatus);
        return id ? { id, title, status } : { title, status };
      })
      .filter((entry): entry is TodoToolTask => entry !== null);
  };

  const escapeMarkdownText = (value: string): string =>
    value.replace(/([\\`*_{}\[\]()#+.!|>~-])/g, '\\$1');

  const buildTodoRuntimeChecklist = (
    toolName: 'plan',
    rawResult: unknown,
  ): string | null => {
    const result = asRecord(rawResult) ?? {};
    const runtime = asRecord(result.todoRuntime) ?? result;
    const operation = String(runtime.operation ?? '').trim();
    const todo = asRecord(runtime.todo);
    const activeTodo = asRecord(runtime.activeTodo);
    const task = asRecord(runtime.task);

    const todoTitle = String(todo?.title ?? activeTodo?.title ?? '').trim();
    const todoId = String(runtime.todoId ?? todo?.id ?? activeTodo?.id ?? '').trim();
    const headerLabel = todoTitle
      ? `Plan ${todoTitle}`
      : todoId
        ? `Plan ${todoId}`
        : 'Plan';

    const tasksFromRuntime = asTaskList(runtime.tasks);
    const tasksFromResult = asTaskList(result.tasks);
    let taskItems = tasksFromRuntime.length > 0 ? tasksFromRuntime : tasksFromResult;

    if (taskItems.length === 0 && task) {
      const taskTitle = String(task.title ?? '').trim();
      if (taskTitle) {
        taskItems = [{
          id: String(task.id ?? '').trim() || undefined,
          title: taskTitle,
          status: normalizeTaskStatus(task.status ?? task.derivedStatus),
        }];
      }
    }

    if (taskItems.length === 0) return null;

    const lines = [headerLabel];
    for (const item of taskItems) {
      const done = normalizeTaskStatus(item.status) === 'done';
      const safeTitle = escapeMarkdownText(item.title);
      lines.push(done ? `- [x] ~~${safeTitle}~~` : `- [ ] ${safeTitle}`);
    }
    if (operation === 'update_task' && taskItems.length === 1) {
      lines.push(`_Task status: ${normalizeTaskStatus(taskItems[0].status)}_`);
    }
    return lines.join('\n');
  };

  const summarizePreviewText = (value: string): string => {
    const normalized = value.trim();
    if (!normalized) return '';
    if (normalized.length <= 320) return normalized;
    return `${normalized.slice(-320)}`;
  };

  const applyEvent = (
    eventType: string,
    data: any,
    sequence: number,
    createdAt?: string,
    options?: {
      collectDetails?: boolean;
      collectContent?: boolean;
      preserveAuxPreview?: boolean;
    },
  ) => {
    const collectDetails = options?.collectDetails ?? true;
    const collectContent = options?.collectContent ?? true;
    const preserveAuxPreview = options?.preserveAuxPreview ?? true;
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
        if (collectDetails) upsertStep(st.stepTitle, label);
      } else if (state === 'reasoning_effort') {
        const effort = String(data?.effort ?? '').trim() || 'unknown';
        const phase = String(data?.phase ?? '').trim();
        const it = data?.iteration != null ? String(data.iteration) : '';
        const label = `${effort}${phase ? ` — ${phase}${it ? ` #${it}` : ''}` : ''}`;
        st.stepKind = 'reasoning';
        st.stepTitle = $_('stream.reasoningEffort');
        st.auxText = label;
        if (collectDetails) upsertStep(st.stepTitle, label);
      } else if (state === 'reasoning_effort_eval_failed') {
        const msg = String(data?.message ?? '').trim() || $_('stream.unknownError');
        st.stepKind = 'reasoning';
        st.stepTitle = $_('stream.reasoningEffortFailed');
        st.auxText = msg;
        if (collectDetails) upsertStep(st.stepTitle, msg);
      } else if (state === 'context_budget_update') {
        const pctRaw = Number(data?.occupancy_pct);
        const pct = Number.isFinite(pctRaw)
          ? Math.max(0, Math.min(100, Math.round(pctRaw)))
          : null;
        const zoneRaw = String(data?.zone ?? 'normal');
        const zone = zoneRaw === 'hard' || zoneRaw === 'soft' ? zoneRaw : 'normal';
        st.contextBudgetPct = pct;
        st.contextBudgetZone = zone;
        const line = pct === null
          ? $_('stream.contextBudget')
          : $_('stream.contextOccupancy', { values: { pct } });
        st.stepKind = 'status';
        st.stepTitle = $_('stream.contextBudget');
        st.auxText = line;
        if (collectDetails) upsertStep(st.stepTitle, line);
      } else if (state === 'context_compaction_started') {
        st.contextCompactionStrip = $_('stream.contextCompactionInProgress');
        st.stepKind = 'status';
        st.stepTitle = $_('stream.contextCompaction');
        st.auxText = $_('stream.contextCompactionInProgress');
        if (collectDetails) upsertStep(st.stepTitle, st.auxText);
      } else if (state === 'context_compaction_done') {
        st.contextCompactionStrip = $_('stream.contextCompactionDone');
        st.stepKind = 'status';
        st.stepTitle = $_('stream.contextCompaction');
        st.auxText = $_('stream.contextCompactionDone');
        if (collectDetails) upsertStep(st.stepTitle, st.auxText);
      } else if (state === 'context_compaction_failed') {
        st.contextCompactionStrip = $_('stream.contextCompactionFailed');
        st.stepKind = 'status';
        st.stepTitle = $_('stream.contextCompaction');
        st.auxText = String(data?.message ?? $_('stream.unknownError'));
        if (collectDetails) upsertStep(st.stepTitle, st.auxText);
      } else if (state === 'context_budget_user_escalation_required') {
        st.stepKind = 'status';
        st.stepTitle = $_('stream.contextBudgetEscalation');
        st.auxText = $_('stream.contextBudgetEscalationBody');
        if (collectDetails) upsertStep(st.stepTitle, st.auxText);
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
      if (collectDetails) {
        const prev = st.auxText || '';
        const sep = needsReasoningSectionBreak(prev, delta) ? '\n\n' : '';
        st.auxText = prev + sep + delta;
        upsertStep(st.stepTitle, st.auxText);
      } else if (preserveAuxPreview) {
        st.auxText = summarizePreviewText(delta);
      }
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
      if (collectDetails) upsertStep(st.stepTitle, args || undefined);
    } else if (eventType === 'tool_call_delta') {
      st.sawTools = true;
      st.sawStarted = false;
      const toolId = String(data?.tool_call_id ?? '').trim() || 'unknown';
      const delta = String(data?.delta ?? '');
      if (toolId && toolId !== 'unknown') st.toolCallIds.add(toolId);
      if (collectDetails) {
        st.toolArgsById[toolId] = (st.toolArgsById[toolId] ?? '') + delta;
      } else if (preserveAuxPreview) {
        st.toolArgsById[toolId] = summarizePreviewText(
          `${st.toolArgsById[toolId] ?? ''}${delta}`,
        );
      }
      const toolName = st.toolNameById[toolId];
      st.stepKind = 'tool';
      st.stepTitle = toolName
        ? $_('stream.toolArgs', { values: { name: toolName } })
        : $_('stream.toolArgsFallback');
      if (collectDetails) {
        st.auxText = st.toolArgsById[toolId];
        upsertStep(st.stepTitle, st.auxText);
      } else if (preserveAuxPreview) {
        st.auxText = summarizePreviewText(st.toolArgsById[toolId]);
      }
    } else if (eventType === 'tool_call_result') {
      st.sawTools = true;
      st.sawStarted = false;
      const status = String(data?.result?.status ?? (data?.result ? 'completed' : 'unknown'));
      const err = data?.result?.error;
      const toolId = String(data?.tool_call_id ?? '').trim();
      const toolName = toolId ? st.toolNameById[toolId] : undefined;
      const runtimeToolName = (() => {
        const runtime = asRecord(data?.result?.todoRuntime);
        const candidate = typeof runtime?.tool === 'string' ? runtime.tool : '';
        return isTodoRuntimeToolName(candidate) ? candidate : undefined;
      })();
      const label = toolName ? `${toolName} (${err ? 'error' : status})` : (err ? 'erreur' : status);
      st.stepKind = 'tool';
      st.stepTitle = $_('stream.tool', { values: { name: label } });
      st.auxText = '';
      let toolResultBody: string | undefined;
      if (err) {
        st.auxText = String(err);
        toolResultBody = String(err);
      } else {
        const checklist = buildTodoRuntimeChecklist(
          (isTodoRuntimeToolName(toolName) ? toolName : runtimeToolName) ?? 'plan',
          data?.result,
        );
        if (checklist) {
          st.auxText = checklist;
          toolResultBody = checklist;
        }
      }
      if (collectDetails) upsertStep(st.stepTitle, toolResultBody);
      if (toolId && (isTodoRuntimeToolName(toolName) || runtimeToolName)) {
        const resultRecord =
          data?.result && typeof data.result === 'object' && !Array.isArray(data.result)
            ? (data.result as Record<string, unknown>)
            : {};
        onTodoRuntime?.({
          toolCallId: toolId,
          toolName: (isTodoRuntimeToolName(toolName) ? toolName : runtimeToolName) as
            'plan',
          result: resultRecord,
        });
      }
      if (toolId && toolName === 'plan') {
        const todoCard = parseTodoToolCard(toolId, data?.result);
        if (todoCard) {
          upsertTodoToolCard(todoCard);
        }
      }
      // Notify parent of document_generate completed results with a download target
      if (
        toolName === 'document_generate' &&
        data?.result?.status === 'completed' &&
        typeof data?.result?.jobId === 'string' &&
        typeof data?.result?.fileName === 'string'
      ) {
        onGeneratedFile?.({
          jobId: data.result.jobId as string,
          fileName: data.result.fileName as string,
          format:
            typeof data?.result?.format === 'string' && data.result.format.trim().length > 0
              ? data.result.format.trim().toLowerCase()
              : 'docx',
          mimeType:
            typeof data?.result?.mimeType === 'string' ? data.result.mimeType : undefined,
          downloadUrl:
            typeof data?.result?.downloadUrl === 'string' ? data.result.downloadUrl : undefined,
        });
      }
    } else if (eventType === 'content_delta') {
      st.sawStarted = false;
      st.stepKind = 'content';
      st.stepTitle = $_('stream.response');
      const delta = String(data?.delta ?? '');
      if (collectContent) {
        st.contentText = (st.contentText || '') + delta;
        if (smoothContentStreaming && variant === 'chat') {
          pushSmoothedDelta(delta);
        } else {
          smoothPendingText = '';
          cancelSmoothTimer();
          smoothedContentText = st.contentText || '';
        }
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

  const applyEventsSummary = (
    events: Array<{ eventType: string; data: any; sequence: number; createdAt?: string }>,
  ) => {
    for (const ev of events) {
      applyEvent(ev.eventType, ev.data, ev.sequence, ev.createdAt, {
        collectDetails: false,
        collectContent: false,
        preserveAuxPreview: showRuntimeInlinePreview,
      });
    }
    st = {
      ...st,
      toolCallIds: new Set(st.toolCallIds),
      toolArgsById: { ...st.toolArgsById },
      toolNameById: { ...st.toolNameById },
      steps: [],
      todoCards: [...st.todoCards],
    };
  };

  const shouldDeferCollapsedDetails = () =>
    deferCollapsedDetails &&
    subscriptionMode === 'passive' &&
    !st.expanded;

  const formatDuration = (inputMs: number | null): string => {
    if (!Number.isFinite(inputMs) || inputMs === null || inputMs < 0) {
      return '0mn00s';
    }
    const totalSeconds = Math.max(0, Math.floor(inputMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}mn${String(seconds).padStart(2, '0')}s`;
  };

  const compactReasoningEffortLabel = (value: string | null): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const direct = trimmed.split(' (via ')[0]?.trim() ?? '';
    if (direct) return direct;
    return trimmed;
  };

  const summarizePassiveHistoryShell = (
    summary:
      | {
          hasReasoning: boolean;
          hasTools: boolean;
          toolCount: number;
          contextBudgetPct: number | null;
          durationMs: number | null;
          reasoningEffortLabel: string | null;
        }
      | undefined,
  ): { visible: boolean; heading: string } => {
    if (!summary) return { visible: false, heading: '' };
    const effortLabel = compactReasoningEffortLabel(summary.reasoningEffortLabel);
    if (summary.hasReasoning && summary.hasTools) {
      return {
        visible: true,
        heading: [
          `${$_('stream.reasoning')}${effortLabel ? ` ${effortLabel}` : ''} ${formatDuration(summary.durationMs)}`.trim(),
          $_('stream.toolCalls', {
            values: { count: Math.max(1, summary.toolCount) },
          }),
        ].join(' - '),
      };
    }
    if (summary.hasReasoning) {
      return {
        visible: true,
        heading: `${$_('stream.reasoning')}${effortLabel ? ` ${effortLabel}` : ''} ${formatDuration(summary.durationMs)}`.trim(),
      };
    }
    if (summary.hasTools) {
      return {
        visible: true,
        heading: $_('stream.toolCalls', {
          values: { count: Math.max(1, summary.toolCount) },
        }),
      };
    }
    if (summary.contextBudgetPct !== null) {
      return {
        visible: true,
        heading: $_('stream.contextOccupancy', {
          values: { pct: summary.contextBudgetPct },
        }),
      };
    }
    return { visible: false, heading: '' };
  };

  const hydrateDeferredDetails = () => {
    if (!initialEvents || initialEvents.length === 0) return;
    if (detailHydrated) return;
    const keepExpanded = st.expanded;
    reset();
    st = { ...st, expanded: keepExpanded };
    applyEvents(initialEvents as any);
    detailHydrated = true;
    detailLoaded = true;
    detailDomMounted = true;
    detailLoading = false;
    lastInitialEventCount = initialEvents.length;
    lastInitialEventsRef = initialEvents;
  };

  const hydrateHistory = async () => {
    if (subscriptionMode === 'passive') return;
    if (!streamId) return;
    if (initialEvents && initialEvents.length > 0) {
      applyEvents(initialEvents as any);
      detailLoaded = true;
      return;
    }
    detailLoaded = false;
    detailLoading = false;
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
      contextBudgetPct: null,
      contextBudgetZone: 'normal',
      contextCompactionStrip: '',
      expanded: initiallyExpanded,
      lastSeq: 0
    };
    smoothedContentText = '';
    smoothPendingText = '';
    detailLoading = false;
    detailLoaded = false;
    detailHydrated = false;
    detailDomMounted = false;
    lastInitialEventsRef = null;
    lastInitialEventCount = 0;
    terminalNotified = false;
  };

  $: if (streamId && streamId !== subscribedTo) {
    if (subscriptionMode === 'live') {
      unsubscribe();
      reset();
      void subscribe(streamId);
    }
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

  $: {
    st;
    finalText;
    acknowledgementText;
    historyPending;
    detailLoading;
    detailLoaded;
    variant;
    subscriptionMode;
    hasSteps = st.sawReasoning || st.sawTools || st.steps.length > 0;
    hasContent = !!st.contentText && st.contentText.trim().length > 0;
    hasAcknowledgement =
      typeof acknowledgementText === 'string' &&
      acknowledgementText.trim().length > 0;
    showStartup = !!st.sawStarted && !hasSteps && !hasContent && !finalText;
    toolsCount = st.toolCallIds.size;
    const passiveHistoryShell = summarizePassiveHistoryShell(runtimeSummary);
    hasPassiveHistoryShell =
      variant === 'chat' &&
      subscriptionMode === 'passive' &&
      !hasContent &&
      passiveHistoryShell.visible;
    passiveHistoryShellHeading = passiveHistoryShell.heading;
    durationMs =
      variant === 'chat' &&
      subscriptionMode === 'passive' &&
      runtimeSummary?.durationMs !== null &&
      runtimeSummary?.durationMs !== undefined
        ? runtimeSummary.durationMs
        : (st.endedAtMs ?? Date.now()) - st.startedAtMs;
    showDetailLoader =
      (
        variant === 'chat' &&
        subscriptionMode === 'live' &&
        (historyPending || detailLoading) &&
        !detailLoaded &&
        !hasSteps &&
        !showStartup &&
        !!finalText
      ) ||
      (
        variant === 'chat' &&
        subscriptionMode === 'passive' &&
        detailLoading &&
        !detailLoaded &&
        st.expanded
      );
  }

  // Si le parent injecte les events après coup (batch), on les applique sans re-fetch
  $: if (initialEvents && initialEvents !== lastInitialEventsRef) {
    const previousInitialEventsRef = lastInitialEventsRef;
    lastInitialEventsRef = initialEvents;
    if (subscriptionMode === 'passive') {
      const firstSeq = Number(initialEvents[0]?.sequence ?? 0);
      const lastSeqInBatch = Number(initialEvents.at(-1)?.sequence ?? 0);
      const sameWindow =
        initialEvents.length === lastInitialEventCount &&
        lastSeqInBatch === st.lastSeq &&
        (initialEvents.length === 0 || firstSeq <= st.lastSeq);
      const deferDetails = shouldDeferCollapsedDetails();
      const isDeferredDetailUpgrade =
        deferCollapsedDetails &&
        subscriptionMode === 'passive' &&
        st.expanded &&
        initialEvents.length > 0 &&
        initialEvents !== previousInitialEventsRef;
      const shouldReplayFromScratch =
        isDeferredDetailUpgrade ||
        !sameWindow &&
        (
          st.lastSeq === 0 ||
          initialEvents.length < lastInitialEventCount ||
          (initialEvents.length > 0 && firstSeq > st.lastSeq)
        );
      if (shouldReplayFromScratch) {
        const keepExpanded = st.expanded;
        unsubscribe();
        reset();
        st = { ...st, expanded: keepExpanded };
      }
      if (initialEvents.length > 0) {
        if (deferDetails) {
          const keepExpanded = st.expanded;
          reset();
          st = { ...st, expanded: keepExpanded };
          applyEventsSummary(initialEvents as any);
          detailHydrated = false;
        } else {
          const nextEvents = shouldReplayFromScratch
            ? initialEvents
            : initialEvents.filter((event) => Number(event.sequence) > st.lastSeq);
          if (nextEvents.length > 0) {
            applyEvents(nextEvents as any);
          }
          detailHydrated = true;
          detailDomMounted = true;
        }
      }
    } else if (initialEvents.length > 0) {
      applyEvents(initialEvents as any);
      detailHydrated = true;
      detailDomMounted = true;
    }
    lastInitialEventCount = initialEvents.length;
    detailLoaded = !shouldDeferCollapsedDetails();
    detailLoading = false;
  }

</script>

<div class="w-full max-w-full">
    {#if variant === 'chat' && hasAcknowledgement}
      <div class="text-[11px] text-slate-500 mt-0.5">
        {acknowledgementText}
      </div>
    {/if}
    {#if variant === 'chat' && st.contextCompactionStrip}
      <div class="mt-1 rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
        {st.contextCompactionStrip}
      </div>
    {/if}
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
    {#if hasSteps || hasPassiveHistoryShell}
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <div class="text-[11px] text-slate-500">
          {#if subscriptionMode === 'passive' && !showRuntimeInlinePreview && passiveHistoryShellHeading}
            {passiveHistoryShellHeading}
          {:else if hasSteps}
            {#if st.sawReasoning}{$_('stream.reasoning')} {Math.max(0, Math.floor(durationMs / 60000))}m{String(Math.max(0, Math.floor(durationMs / 1000)) % 60).padStart(2, '0')}s{/if}
            {#if st.sawReasoning && toolsCount > 0}, {/if}
            {#if toolsCount > 0}{$_('stream.toolCalls', { values: { count: toolsCount } })}{/if}
            {#if st.contextBudgetPct !== null}
              {#if st.sawReasoning || toolsCount > 0}, {/if}
              {$_('stream.contextOccupancy', { values: { pct: st.contextBudgetPct } })}
            {/if}
          {/if}
        </div>
        <button
          class="text-slate-500 hover:text-slate-700 p-1 rounded hover:bg-slate-100 shrink-0"
          type="button"
          aria-label={st.expanded ? $_('stream.actions.collapseDetails') : $_('stream.actions.expandDetails')}
          on:click={async () => {
            const shouldHydrateDetails =
              deferCollapsedDetails &&
              subscriptionMode === 'passive' &&
              !detailHydrated &&
              !st.expanded;
            if (!st.expanded && shouldHydrateDetails) {
              if (requestDeferredDetails) {
                detailLoading = true;
                try {
                  await requestDeferredDetails();
                } finally {
                  detailLoading = false;
                }
              } else {
                hydrateDeferredDetails();
              }
              detailDomMounted = true;
              st = { ...st, expanded: true };
              return;
            }
            const nextExpanded = !st.expanded;
            if (nextExpanded) detailDomMounted = true;
            st = { ...st, expanded: nextExpanded };
          }}
        >
          <ChevronDown
            class="w-4 h-4 transition-transform duration-150 {st.expanded ? 'rotate-180' : ''}"
          />
        </button>
      </div>
      {#if detailDomMounted}
        <div class="mt-1 bg-transparent border border-slate-100 rounded p-2" class:hidden={!st.expanded}>
          <ul class="space-y-2">
            {#each st.steps as step, i (i)}
              <li class="text-[11px] text-slate-600">
                <div class="font-medium text-slate-600">{step.title}</div>
                {#if step.body}
                  <div
                    class="stream-aux-markdown mt-0.5 text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto slim-scroll [&_*]:text-slate-400"
                    use:scrollToEnd
                  >
                    {#if step.kind === 'reasoning' || step.kind === 'tool'}
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
        {#if showStartup && showRuntimeInlinePreview}
          <div class="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            <span>{$_('stream.preparing')}</span>
          </div>
        {/if}
        {#if hasSteps && !hasContent && showRuntimeInlinePreview}
          <div class="text-[11px] text-slate-500">{$_('stream.stepRunning', { values: { title: st.stepTitle || $_('stream.inProgress') } })}</div>
          {#if st.auxText}
            <div
              class="stream-aux-markdown mt-1 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-16 overflow-y-auto slim-scroll [&_*]:text-slate-400"
              use:scrollToEnd
            >
              {#if st.stepKind === 'reasoning' || st.stepKind === 'tool'}
                <Streamdown content={st.auxText} />
              {:else}
                {st.auxText}
              {/if}
            </div>
          {/if}
        {/if}
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

  /* Keep code blocks and inline code aligned with message text size. */
  .chatMarkdown :global(code),
  .stream-aux-markdown :global(code),
  .chatMarkdown :global(pre code),
  .stream-aux-markdown :global(pre code),
  .chatMarkdown :global(pre code *),
  .stream-aux-markdown :global(pre code *) {
    font-size: inherit !important;
    line-height: inherit !important;
  }

  /* Streamdown can inject wrappers with text-sm around fenced code.
     Keep code typography aligned with chat body size in all hosts (web + VSCode). */
  .chatMarkdown :global(.text-sm),
  .stream-aux-markdown :global(.text-sm) {
    font-size: inherit !important;
    line-height: inherit !important;
  }

  .chatMarkdown :global(pre),
  .stream-aux-markdown :global(pre),
  .chatMarkdown :global(.shiki),
  .stream-aux-markdown :global(.shiki),
  .chatMarkdown :global([data-rehype-pretty-code-fragment]),
  .stream-aux-markdown :global([data-rehype-pretty-code-fragment]),
  .chatMarkdown :global([data-rehype-pretty-code-figure]),
  .stream-aux-markdown :global([data-rehype-pretty-code-figure]) {
    margin: 0.35rem 0;
    padding: 0 !important;
    border-radius: 0.375rem;
    overflow: auto;
    font-size: inherit !important;
    line-height: inherit !important;
  }

  .chatMarkdown :global(pre > code),
  .stream-aux-markdown :global(pre > code),
  .chatMarkdown :global(.shiki > code),
  .stream-aux-markdown :global(.shiki > code) {
    display: block;
    padding: 0.55rem 0.7rem !important;
    white-space: pre;
  }

  .chatMarkdown :global([data-rehype-pretty-code-fragment] pre),
  .stream-aux-markdown :global([data-rehype-pretty-code-fragment] pre),
  .chatMarkdown :global([data-rehype-pretty-code-figure] pre),
  .stream-aux-markdown :global([data-rehype-pretty-code-figure] pre) {
    margin: 0 !important;
    border: 0 !important;
  }
</style>
