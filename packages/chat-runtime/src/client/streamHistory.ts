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
