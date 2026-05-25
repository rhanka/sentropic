export type ProjectionStreamEvent = {
  eventType: string;
  data: any;
  sequence: number;
  createdAt?: string;
};

const MAX_LIVE_PROJECTION_EVENTS = 200;
const MAX_COMPRESSIBLE_EVENTS = 100;

export type ProjectedRunSegment = {
  id: string;
  kind: 'assistant' | 'runtime';
  events: ProjectionStreamEvent[];
  content: string;
  steerCountBefore: number;
};

type TimelineMessageLike = {
  id: string;
  role: string;
};

type MutableSegment = {
  id: string;
  kind: 'assistant' | 'runtime';
  events: ProjectionStreamEvent[];
  steerCountBefore: number;
};

const asFiniteSequence = (value: unknown): number | null => {
  const sequence = Number(value);
  return Number.isFinite(sequence) ? sequence : null;
};

const normalizeSteerCount = (value: unknown): number => {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.floor(count);
};

const getStatusState = (event: ProjectionStreamEvent): string => {
  if (event.eventType !== 'status') return '';
  return String(event.data?.state ?? '').trim();
};

const asProjectionKeyValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${typeof value}:${value}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const getProjectionDedupeKey = (event: ProjectionStreamEvent): string | null => {
  if (event.eventType === 'status') {
    const state = getStatusState(event);
    const stateData = asProjectionKeyValue({
      ...event.data,
      state,
    });
    return `status:${state}:${stateData}`;
  }
  if (
    event.eventType === 'tool_call_start' ||
    event.eventType === 'tool_call_delta' ||
    event.eventType === 'tool_call_result'
  ) {
    const callId = String(event.data?.tool_call_id ?? '').trim();
    const payload = asProjectionKeyValue(
      event.eventType === 'tool_call_start'
        ? {
            tool_call_id: callId,
            name: event.data?.name,
          }
        : event.eventType === 'tool_call_delta'
          ? {
              tool_call_id: callId,
              delta: event.data?.delta,
            }
          : {
              tool_call_id: callId,
              status: event.data?.result?.status,
              error: event.data?.result?.error,
            },
    );
    return callId
      ? `${event.eventType}:${callId}:${payload}`
      : `${event.eventType}:${payload}`;
  }
  return null;
};

const getDelta = (event: ProjectionStreamEvent): string =>
  String(event.data?.delta ?? '');

const getToolCallId = (event: ProjectionStreamEvent): string =>
  String(event.data?.tool_call_id ?? '').trim();

const shouldMergeDeltaEvent = (
  previous: ProjectionStreamEvent | undefined,
  event: ProjectionStreamEvent,
): boolean => {
  if (!previous || previous.eventType !== event.eventType) return false;
  if (event.eventType === 'content_delta' || event.eventType === 'reasoning_delta') {
    return true;
  }
  if (event.eventType !== 'tool_call_delta') return false;
  const toolCallId = getToolCallId(event);
  return Boolean(toolCallId && toolCallId === getToolCallId(previous));
};

const mergeDeltaEvent = (
  previous: ProjectionStreamEvent,
  event: ProjectionStreamEvent,
): ProjectionStreamEvent => ({
  ...event,
  data: {
    ...event.data,
    delta: `${getDelta(previous)}${getDelta(event)}`,
  },
});

const isSteerProjectionStatus = (event: ProjectionStreamEvent): boolean => {
  if (event.eventType !== 'status') return false;
  const state = getStatusState(event);
  return (
    state === 'run_interrupted_for_steer' ||
    state === 'run_resumed_with_steer' ||
    state === 'steer_received'
  );
};

const isCriticalProjectionEvent = (event: ProjectionStreamEvent): boolean =>
  event.eventType === 'content_delta' ||
  event.eventType === 'reasoning_delta' ||
  event.eventType === 'done' ||
  event.eventType === 'error' ||
  isSteerProjectionStatus(event);

const compactProjectionEvents = (
  events: readonly ProjectionStreamEvent[],
): ProjectionStreamEvent[] => {
  const ordered = [...events]
    .filter((event) => asFiniteSequence(event.sequence) !== null)
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));

  const deduped: ProjectionStreamEvent[] = [];
  for (const event of ordered) {
    const previous = deduped.at(-1);
    if (shouldMergeDeltaEvent(previous, event)) {
      deduped[deduped.length - 1] = mergeDeltaEvent(previous!, event);
      continue;
    }
    const key = getProjectionDedupeKey(event);
    const previousKey = previous ? getProjectionDedupeKey(previous) : null;
    if (key && previousKey && key === previousKey) {
      deduped[deduped.length - 1] = event;
      continue;
    }
    deduped.push(event);
  }

  if (deduped.length <= MAX_LIVE_PROJECTION_EVENTS) return deduped;

  const compactible = deduped.filter((event) => !isCriticalProjectionEvent(event));
  if (compactible.length <= MAX_COMPRESSIBLE_EVENTS) return deduped;

  const compactibleToKeep = new Set<ProjectionStreamEvent>(
    compactible.slice(-MAX_COMPRESSIBLE_EVENTS),
  );
  return deduped.filter(
    (event) => isCriticalProjectionEvent(event) || compactibleToKeep.has(event),
  );
};

const isAssistantVisibleEvent = (event: ProjectionStreamEvent): boolean =>
  event.eventType === 'content_delta';

const shouldForceRuntimeBoundary = (
  current: MutableSegment | null,
  event: ProjectionStreamEvent,
): boolean => {
  if (!current || current.kind !== 'runtime' || current.events.length === 0) {
    return false;
  }
  const state = getStatusState(event);
  return (
    state === 'run_interrupted_for_steer' ||
    state === 'run_resumed_with_steer'
  );
};

const buildSegmentId = (
  kind: 'assistant' | 'runtime',
  startSequence: number,
): string => `${kind}:${startSequence}`;

const finalizeSegment = (segment: MutableSegment | null): ProjectedRunSegment | null => {
  if (!segment || segment.events.length === 0) return null;
  const content =
    segment.kind === 'assistant'
      ? segment.events
          .filter((event) => event.eventType === 'content_delta')
          .map((event) => String(event.data?.delta ?? ''))
          .join('')
      : '';
  return {
    id: segment.id,
    kind: segment.kind,
    events: segment.events,
    content,
    steerCountBefore: segment.steerCountBefore,
  };
};

export const projectAssistantRunSegments = (
  events: readonly ProjectionStreamEvent[],
): ProjectedRunSegment[] => {
  const ordered = compactProjectionEvents(events);

  const projected: ProjectedRunSegment[] = [];
  let current: MutableSegment | null = null;
  let terminal: 'done' | 'error' | null = null;

  const flush = () => {
    const next = finalizeSegment(current);
    if (next) projected.push(next);
    current = null;
  };

  for (const event of ordered) {
    if (event.eventType === 'done') {
      terminal = 'done';
      continue;
    }
    if (event.eventType === 'error') {
      terminal = 'error';
    }

    const kind: 'assistant' | 'runtime' = isAssistantVisibleEvent(event)
      ? 'assistant'
      : 'runtime';

    if (
      !current ||
      current.kind !== kind ||
      shouldForceRuntimeBoundary(current, event)
    ) {
      flush();
      current = {
        id: buildSegmentId(kind, event.sequence),
        kind,
        events: [],
        steerCountBefore: 0,
      };
    }

    current.events.push(event);
    if (getStatusState(event) === 'run_resumed_with_steer') {
      current.steerCountBefore += normalizeSteerCount(event.data?.steer_count);
    }
  }

  flush();

  if (
    terminal === 'done' &&
    projected.length > 0 &&
    projected[projected.length - 1]?.kind === 'runtime' &&
    projected.some((segment) => segment.kind === 'assistant')
  ) {
    projected.pop();
  }

  return projected;
};

export const countLinkedSteerMessages = (
  events: readonly ProjectionStreamEvent[],
): number =>
  events.filter(
    (event) =>
      event.eventType === 'status' && getStatusState(event) === 'steer_received',
  ).length;

export const getLinkedSteerMessageIds = <T extends TimelineMessageLike>(
  timeline: readonly T[],
  assistantIndex: number,
  steerCount: number,
): string[] => {
  if (assistantIndex <= 0 || steerCount <= 0) return [];
  const contiguousUsers: T[] = [];
  for (let cursor = assistantIndex - 1; cursor >= 0; cursor -= 1) {
    const candidate = timeline[cursor];
    if (candidate?.role !== 'user') break;
    contiguousUsers.unshift(candidate);
  }
  if (contiguousUsers.length === 0) return [];
  return contiguousUsers
    .slice(Math.max(0, contiguousUsers.length - steerCount))
    .map((message) => message.id);
};

export const mergeProjectionHistoryEvents = (
  current: readonly ProjectionStreamEvent[],
  incoming: readonly ProjectionStreamEvent[],
): ProjectionStreamEvent[] => {
  const bySequence = new Map<number, ProjectionStreamEvent>();
  for (const event of current) {
    const sequence = asFiniteSequence(event.sequence);
    if (sequence === null) continue;
    bySequence.set(sequence, event);
  }
  for (const event of incoming) {
    const sequence = asFiniteSequence(event.sequence);
    if (sequence === null) continue;
    bySequence.set(sequence, event);
  }
  return compactProjectionEvents([...bySequence.values()]);
};

export const appendLiveProjectionEvent = (
  current: readonly ProjectionStreamEvent[],
  incoming: ProjectionStreamEvent,
): ProjectionStreamEvent[] => {
  const sequence = asFiniteSequence(incoming.sequence);
  if (sequence === null) return [...current];
  if (current.some((event) => event.sequence === sequence)) return [...current];
  return compactProjectionEvents([...current, incoming]);
};
