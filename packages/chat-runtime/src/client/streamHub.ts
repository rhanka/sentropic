import { StreamHistory } from './streamHistory.js';
import {
  STREAM_HUB_EVENT_TYPES,
  type RuntimePortLike,
  type StreamHubClient,
  type StreamHubEvent,
  type StreamHubEventHandler,
  type StreamHubOptions,
  type StreamHubSubscription,
} from './streamTypes.js';

/**
 * ALL SSE event type names the router registers EventSource listeners for.
 * Extends STREAM_HUB_EVENT_TYPES with app-layer domain event names so that
 * named server-sent events are received by the EventSource.
 * These strings live here (implementation detail), NOT in the exported
 * STREAM_HUB_EVENT_TYPES which defines the generic package taxonomy.
 */
const ALL_SSE_EVENT_TYPES: readonly string[] = [
  ...STREAM_HUB_EVENT_TYPES,
  'organization_update',
  'folder_update',
  'usecase_update',
  'comment_update',
  'lock_update',
  'presence_update',
  'workspace_update',
  'workspace_membership_update',
];

export const createStreamHub = (options: StreamHubOptions): StreamHubClient => {
  return new StreamHub(options);
};

class StreamHub implements StreamHubClient {
  private readonly options: StreamHubOptions;
  private readonly history: StreamHistory;
  private readonly reconnectDelayMs: number;
  private subs = new Map<string, StreamHubSubscription>();
  private es: EventSource | null = null;
  private extensionPort: RuntimePortLike | null = null;
  private extensionPortOnMessage: ((message: unknown) => void) | null = null;
  private extensionPortOnDisconnect: (() => void) | null = null;
  private currentUrl: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StreamHubOptions) {
    this.options = options;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 150;
    this.history = new StreamHistory({
      maxStreamIds: options.maxStreamIds,
      maxEventsPerStream: options.maxEventsPerStream,
    });
  }

  reset(): void {
    this.history.clear();
    this.close();
    this.scheduleReconnect();
  }

  clearCaches(): void {
    this.history.clear();
  }

  set(key: string, onEvent: StreamHubEventHandler): void {
    this.subs.set(key, { onEvent });
    safelyReplay(() => this.history.replayAll(onEvent));
    this.scheduleReconnect();
  }

  setJobUpdates(key: string, onEvent: StreamHubEventHandler): void {
    this.subs.set(key, { onEvent, onlyType: 'job_update' });
    safelyReplay(() => this.history.replayJobs(onEvent));
    this.scheduleReconnect();
  }

  setStream(
    key: string,
    streamId: string,
    onEvent: StreamHubEventHandler,
  ): void {
    this.subs.set(key, { onEvent, streamId });
    safelyReplay(() => this.history.replayStream(streamId, onEvent));
    this.scheduleReconnect();
  }

  delete(key: string): void {
    this.subs.delete(key);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconnectDelayMs <= 0) {
      this.reconnectTimer = null;
      void this.ensureConnected();
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, this.reconnectDelayMs);
  }

  private close(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.extensionPort) {
      if (this.extensionPortOnMessage) {
        this.extensionPort.onMessage.removeListener(this.extensionPortOnMessage);
        this.extensionPortOnMessage = null;
      }
      if (this.extensionPortOnDisconnect) {
        this.extensionPort.onDisconnect.removeListener(this.extensionPortOnDisconnect);
        this.extensionPortOnDisconnect = null;
      }
