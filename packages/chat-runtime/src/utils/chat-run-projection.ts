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
