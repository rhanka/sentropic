import type { StreamHubEvent, StreamHubEventHandler } from './streamTypes.js';

export type StreamHistoryOptions = {
  maxStreamIds?: number;
  maxEventsPerStream?: number;
};

export class StreamHistory {
  private readonly maxStreamIds: number;
  private readonly maxEventsPerStream: number;
  private lastJobEventById = new Map<string, StreamHubEvent>();
  private lastOrganizationEventById = new Map<string, StreamHubEvent>();
  private lastFolderEventById = new Map<string, StreamHubEvent>();
  private lastUseCaseEventById = new Map<string, StreamHubEvent>();
  private lastCommentEventByKey = new Map<string, StreamHubEvent>();
  private lastLockEventByKey = new Map<string, StreamHubEvent>();
  private streamHistoryById = new Map<string, StreamHubEvent[]>();

  constructor(options: StreamHistoryOptions = {}) {
    this.maxStreamIds = options.maxStreamIds ?? 50;
    this.maxEventsPerStream = options.maxEventsPerStream ?? 50;
  }

  clear(): void {
    this.lastJobEventById.clear();
    this.lastOrganizationEventById.clear();
    this.lastFolderEventById.clear();
    this.lastUseCaseEventById.clear();
    this.lastCommentEventByKey.clear();
    this.lastLockEventByKey.clear();
    this.streamHistoryById.clear();
  }

  replayAll(onEvent: StreamHubEventHandler): void {
    for (const ev of this.lastJobEventById.values()) onEvent(ev);
    for (const ev of this.lastOrganizationEventById.values()) onEvent(ev);
    for (const ev of this.lastFolderEventById.values()) onEvent(ev);
    for (const ev of this.lastUseCaseEventById.values()) onEvent(ev);
    for (const ev of this.lastCommentEventByKey.values()) onEvent(ev);
    for (const ev of this.lastLockEventByKey.values()) onEvent(ev);
    for (const events of this.streamHistoryById.values()) {
      for (const ev of events) onEvent(ev);
    }
  }

  replayJobs(onEvent: StreamHubEventHandler): void {
    for (const ev of this.lastJobEventById.values()) onEvent(ev);
  }

  replayStream(streamId: string, onEvent: StreamHubEventHandler): void {
    const events = this.streamHistoryById.get(streamId) ?? [];
    for (const ev of events) onEvent(ev);
  }

  record(event: StreamHubEvent): void {
    const type = event.type;
    if (type === 'job_update' && 'jobId' in event) {
      if (event.jobId) this.lastJobEventById.set(event.jobId, event);
      return;
    }
    if (type === 'organization_update' && 'organizationId' in event) {
      if (event.organizationId) {
        this.lastOrganizationEventById.set(event.organizationId, event);
      }
      return;
    }
    if (type === 'folder_update' && 'folderId' in event) {
      if (event.folderId) this.lastFolderEventById.set(event.folderId, event);
      return;
    }
    if (type === 'usecase_update' && 'useCaseId' in event) {
      if (event.useCaseId) this.lastUseCaseEventById.set(event.useCaseId, event);
      return;
    }
    if (type === 'comment_update' && 'contextType' in event && 'contextId' in event) {
      if (event.contextType && event.contextId) {
        this.lastCommentEventByKey.set(
          `${event.contextType}:${event.contextId}`,
          event,
        );
      }
      return;
    }
    if (type === 'lock_update' && 'objectType' in event && 'objectId' in event) {
      if (event.objectType && event.objectId) {
        this.lastLockEventByKey.set(`${event.objectType}:${event.objectId}`, event);
      }
      return;
    }
    if ('streamId' in event && event.streamId) {
      this.recordStreamEvent(event);
    }
  }

  private recordStreamEvent(event: StreamHubEvent & { streamId: string }): void {
    const streamId = event.streamId;
    const previous = this.streamHistoryById.get(streamId) ?? [];
    const last = previous[previous.length - 1];
    if (shouldIgnoreReplayedStreamEvent(last, event)) return;

    const sameTextDeltaKind =
      (event.type === 'reasoning_delta' || event.type === 'content_delta') &&
      last &&
      'streamId' in last &&
      last.type === event.type &&
      last.streamId === streamId;
    const sameToolArgsDelta =
      event.type === 'tool_call_delta' &&
      last &&
      'streamId' in last &&
      last.type === event.type &&
      last.streamId === streamId &&
      getToolCallId(last) &&
      getToolCallId(last) === getToolCallId(event);

    let next: StreamHubEvent[];
    if (sameTextDeltaKind || sameToolArgsDelta) {
      next = [...previous];
      next[next.length - 1] = {
        ...event,
        data: {
          ...asRecord(event.data),
          delta: `${getDelta(last)}${getDelta(event)}`,
        },
      };
    } else if (
      last &&
      'streamId' in last &&
      last.type === event.type &&
      last.streamId === streamId
    ) {
      next = [...previous];
      next[next.length - 1] = event;
    } else {
      next = [...previous, event];
    }

    if (next.length > this.maxEventsPerStream) {
      next = next.slice(-this.maxEventsPerStream);
    }
    this.streamHistoryById.set(streamId, next);

    if (this.streamHistoryById.size > this.maxStreamIds) {
      const firstKey = this.streamHistoryById.keys().next().value;
      if (firstKey) this.streamHistoryById.delete(firstKey);
    }
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const getDelta = (event: StreamHubEvent): string =>
  String(asRecord(event.data).delta ?? '');

const getToolCallId = (event: StreamHubEvent): string =>
  String(asRecord(event.data).tool_call_id ?? '');

const getSequence = (event: StreamHubEvent): number =>
  'sequence' in event ? Number(event.sequence) : Number.NaN;

const shouldIgnoreReplayedStreamEvent = (
  last: StreamHubEvent | undefined,
  event: StreamHubEvent & { streamId: string },
): boolean => {
  if (!last || !('streamId' in last)) return false;
  if (last.streamId !== event.streamId || last.type !== event.type) return false;

  const lastSequence = getSequence(last);
  const eventSequence = getSequence(event);
  if (!Number.isFinite(lastSequence) || !Number.isFinite(eventSequence)) {
    return false;
  }
  if (eventSequence > lastSequence) return false;

  if (event.type === 'tool_call_delta') {
    const lastToolCallId = getToolCallId(last);
    return Boolean(lastToolCallId && lastToolCallId === getToolCallId(event));
  }
  return true;
};
