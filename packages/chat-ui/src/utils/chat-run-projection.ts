export type ProjectionStreamEvent = {
  eventType: string;
  data: any;
  sequence: number;
  createdAt?: string;
};

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
  const ordered = [...events]
    .filter((event) => asFiniteSequence(event.sequence) !== null)
    .sort((left, right) => left.sequence - right.sequence);

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
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
};

export const appendLiveProjectionEvent = (
  current: readonly ProjectionStreamEvent[],
  incoming: ProjectionStreamEvent,
): ProjectionStreamEvent[] => {
  const sequence = asFiniteSequence(incoming.sequence);
  if (sequence === null) return [...current];
  if (current.some((event) => event.sequence === sequence)) return [...current];
  return [...current, incoming].sort((left, right) => left.sequence - right.sequence);
};
