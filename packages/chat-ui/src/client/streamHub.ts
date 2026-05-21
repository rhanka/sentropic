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
      try {
        this.extensionPort.disconnect();
      } catch {
        // noop
      }
      this.extensionPort = null;
    }
    this.currentUrl = null;
  }

  private getTrackedStreamIds(): string[] {
    return Array.from(
      new Set(
        Array.from(this.subs.values())
          .map((sub) => sub.streamId)
          .filter((id): id is string => Boolean(id)),
      ),
    ).sort();
  }

  private handleSseEvent(type: string, parsed: unknown): void {
    const payload = asRecord(parsed);
    if (type === 'job_update') {
      this.dispatch({
        type,
        jobId: String(payload.jobId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'organization_update') {
      this.dispatch({
        type,
        organizationId: String(payload.organizationId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'folder_update') {
      this.dispatch({
        type,
        folderId: String(payload.folderId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'usecase_update') {
      this.dispatch({
        type,
        useCaseId: String(payload.useCaseId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'comment_update') {
      this.dispatch({
        type,
        contextType: String(payload.contextType ?? ''),
        contextId: String(payload.contextId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'lock_update') {
      this.dispatch({
        type,
        objectType: String(payload.objectType ?? ''),
        objectId: String(payload.objectId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'presence_update') {
      this.dispatch({
        type,
        objectType: String(payload.objectType ?? ''),
        objectId: String(payload.objectId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'workspace_update') {
      this.dispatch({
        type,
        workspaceId: String(payload.workspaceId ?? ''),
        data: payload.data,
      });
      return;
    }
    if (type === 'workspace_membership_update') {
      this.dispatch({
        type,
        workspaceId: String(payload.workspaceId ?? ''),
        userId:
          typeof payload.userId === 'string' ? payload.userId : undefined,
        data: payload.data,
      });
      return;
    }
    if (type === 'ping') {
      this.dispatch({ type, data: parsed });
      return;
    }

    const streamId = String(payload.streamId ?? '');
    const sequence = Number(payload.sequence);
    if (streamId && Number.isFinite(sequence)) {
      this.dispatch({ type, streamId, sequence, data: payload.data });
    }
  }

  private connectExtensionProxySse(
    baseUrl: string,
    workspaceId: string | null,
    streamIds: string[],
  ): boolean {
    const port = this.options.extensionPortFactory?.() ?? null;
    if (!port) return false;

    this.extensionPort = port;
    this.extensionPortOnMessage = (message: unknown) => {
      const payload = asRecord(message);
      if (payload.type === 'sse_event' && typeof payload.eventType === 'string') {
        this.handleSseEvent(payload.eventType, payload.payload);
        return;
      }
      if (payload.type === 'sse_error' || payload.type === 'sse_closed') {
        this.scheduleReconnect();
      }
    };
    this.extensionPortOnDisconnect = () => {
      if (this.extensionPort !== port) return;
      this.extensionPort = null;
      this.extensionPortOnMessage = null;
      this.extensionPortOnDisconnect = null;
      this.scheduleReconnect();
    };

    port.onMessage.addListener(this.extensionPortOnMessage);
    port.onDisconnect.addListener(this.extensionPortOnDisconnect);

    try {
      port.postMessage({
        type: 'stream_proxy_start',
        payload: {
          baseUrl,
          workspaceId,
          streamIds,
        },
      });
      return true;
    } catch {
      try {
        port.disconnect();
      } catch {
        // noop
      }
      this.extensionPort = null;
      this.extensionPortOnMessage = null;
      this.extensionPortOnDisconnect = null;
      return false;
    }
  }

  private dispatch(event: StreamHubEvent): void {
    this.history.record(event);
    this.dispatchBrowserEvents(event);

    for (const sub of this.subs.values()) {
      try {
        if (sub.onlyType && event.type !== sub.onlyType) continue;
        if (sub.streamId) {
          if (!('streamId' in event) || event.streamId !== sub.streamId) {
            continue;
          }
        }
        sub.onEvent(event);
      } catch {
        // ignore
      }
    }
  }

  private dispatchBrowserEvents(event: StreamHubEvent): void {
    const target = this.options.eventTarget;
    if (!target || typeof CustomEvent === 'undefined') return;
    if (event.type === 'workspace_membership_update') {
      target.dispatchEvent(
        new CustomEvent('streamhub:workspace_membership_update', {
          detail: event,
        }),
      );
      return;
    }
    if (event.type === 'workspace_update') {
      target.dispatchEvent(
        new CustomEvent('streamhub:workspace_update', { detail: event }),
      );
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.options.getAuthState()) {
      this.close();
      return;
    }
    if (this.subs.size === 0) {
      this.close();
      return;
    }

    const baseUrl = this.options.getBaseUrl();
    if (!baseUrl) {
      this.close();
      return;
    }
    const workspaceId = this.options.getWorkspaceId?.() ?? null;
    const streamIds = this.getTrackedStreamIds();
    const shouldUseExtension = this.options.shouldUseExtensionProxy
      ? this.options.shouldUseExtensionProxy()
      : Boolean(this.options.extensionPortFactory);

    if (shouldUseExtension) {
      const connectionKey = JSON.stringify({
        baseUrl,
        workspaceId,
        streamIds,
      });
      const extensionUrl = `ext-sse:${connectionKey}`;
      if (this.currentUrl === extensionUrl && this.extensionPort) return;

      this.close();
      const connected = this.connectExtensionProxySse(
        baseUrl,
        workspaceId,
        streamIds,
      );
      if (connected) {
        this.currentUrl = extensionUrl;
        return;
      }
      this.close();
      this.scheduleReconnect();
      return;
    }

    const url = buildSseUrl(
      baseUrl,
      workspaceId,
      this.options.getUrlBaseOrigin?.(),
    );
    if (this.es && this.currentUrl === url) return;

    this.close();
    const source = this.createEventSource(url);
    this.es = source;
    this.currentUrl = url;

    const handle = (type: string, raw: MessageEvent) => {
      try {
        this.handleSseEvent(type, JSON.parse(String(raw.data)));
      } catch {
        // ignore
      }
    };

    for (const type of STREAM_HUB_EVENT_TYPES) {
      source.addEventListener(type, (event) => handle(type, event as MessageEvent));
    }
    source.onerror = () => {
      // Native EventSource reconnects by itself.
    };
  }

  private createEventSource(url: string): EventSource {
    if (this.options.eventSourceFactory) {
      return this.options.eventSourceFactory(url, { withCredentials: true });
    }
    return new EventSource(url, { withCredentials: true } as EventSourceInit);
  }
}

const buildSseUrl = (
  baseUrl: string,
  workspaceId: string | null,
  origin: string | undefined,
): string => {
  const baseOrigin =
    origin ??
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const url = new URL(`${baseUrl}/streams/sse`, baseOrigin);
  if (workspaceId) url.searchParams.set('workspace_id', workspaceId);
  return url.toString();
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const safelyReplay = (replay: () => void): void => {
  try {
    replay();
  } catch {
    // ignore
  }
};
