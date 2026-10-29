/**
 * Generic stream lifecycle event types registered in the package.
 * Domain-specific event types (organization_update, folder_update, etc.) live
 * in the app layer and are handled via the open StreamHubEvent member at runtime.
 * The SSE router in streamHub.ts registers additional event types internally
 * (ALL_SSE_EVENT_TYPES) so that named server-sent events are still received.
 */
export const STREAM_HUB_EVENT_TYPES = [
  'job_update',
  'ping',
  'status',
  'reasoning_delta',
  'tool_call_start',
  'tool_call_delta',
  'tool_call_result',
  'content_delta',
  'error',
  'done',
] as const;

/**
 * Open StreamHub event type — any of the core lifecycle types or an
 * arbitrary string for host-specific / domain event types. The `(string & {})`
 * trick preserves IDE autocompletion for the known literals while accepting any value.
 */
export type StreamHubEventType = (typeof STREAM_HUB_EVENT_TYPES)[number] | (string & {});

/**
 * Generic chat stream lifecycle events.
 * Domain-specific event types (organization_update, folder_update, etc.) are
 * represented by the open `{ type: string }` member and handled app-side.
 * Zero sentropic domain strings appear in this union.
 */
export type StreamHubEvent =
  | { type: 'job_update'; jobId: string; data: unknown }
  | { type: 'ping'; data: unknown }
  | { type: string; streamId: string; sequence: number; data: unknown }
  | { type: string; data: unknown };

export type StreamHubEventHandler = (event: StreamHubEvent) => void;

export type GeneratedFileFormat = 'docx' | 'pptx';

export type GeneratedFileCard = {
  jobId: string;
  fileName: string;
  format?: GeneratedFileFormat | string;
  mimeType?: string;
  downloadUrl?: string;
};

export type StreamHubSubscription = {
  onEvent: StreamHubEventHandler;
  streamId?: string;
  /** Filter events by type. Accepts any string (open type). */
  onlyType?: StreamHubEventType;
  /** Filter events by multiple types. Accepts any strings (open type). */
  onlyTypes?: StreamHubEventType[];
};

export type RuntimePortLike = {
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  onMessage: {
    addListener: (listener: (message: unknown) => void) => void;
    removeListener: (listener: (message: unknown) => void) => void;
  };
  onDisconnect: {
    addListener: (listener: () => void) => void;
    removeListener: (listener: () => void) => void;
  };
};

export type StreamHubOptions = {
  getBaseUrl: () => string | null | undefined;
  getAuthState: () => boolean;
  getWorkspaceId?: () => string | null | undefined;
  getUrlBaseOrigin?: () => string | undefined;
  shouldUseExtensionProxy?: () => boolean;
  eventSourceFactory?: (
    url: string,
    options?: { withCredentials?: boolean },
  ) => EventSource;
  extensionPortFactory?: () => RuntimePortLike | null;
  eventTarget?: EventTarget;
  reconnectDelayMs?: number;
  maxStreamIds?: number;
  maxEventsPerStream?: number;
};

export type StreamHubClient = {
  reset(): void;
  clearCaches(): void;
  set(key: string, onEvent: StreamHubEventHandler): void;
  /** Compatibility alias for `set` that filters to `job_update` events only. */
  setJobUpdates(key: string, onEvent: StreamHubEventHandler): void;
  setStream(key: string, streamId: string, onEvent: StreamHubEventHandler): void;
  delete(key: string): void;
};
