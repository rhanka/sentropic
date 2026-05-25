export type StreamHubEvent =
  | { type: 'job_update'; jobId: string; data: unknown }
  | { type: 'organization_update'; organizationId: string; data: unknown }
  | { type: 'folder_update'; folderId: string; data: unknown }
  | { type: 'usecase_update'; useCaseId: string; data: unknown }
  | { type: 'comment_update'; contextType: string; contextId: string; data: unknown }
  | { type: 'lock_update'; objectType: string; objectId: string; data: unknown }
  | { type: 'presence_update'; objectType: string; objectId: string; data: unknown }
  | { type: 'workspace_update'; workspaceId: string; data: unknown }
  | { type: 'workspace_membership_update'; workspaceId: string; userId?: string; data: unknown }
  | { type: 'ping'; data: unknown }
  | { type: string; streamId: string; sequence: number; data: unknown };

export type StreamHubEventHandler = (event: StreamHubEvent) => void;

export type GeneratedFileFormat = 'docx' | 'pptx';
export type GeneratedFileKind = 'file' | 'image';

export type GeneratedFileCard = {
  jobId: string;
  fileName: string;
  format?: GeneratedFileFormat | string;
  mimeType?: string;
  downloadUrl?: string;
  kind?: GeneratedFileKind;
  documentId?: string;
  previewUrl?: string;
  providerId?: string;
  modelId?: string;
  prompt?: string;
};

export type StreamHubSubscription = {
  onEvent: StreamHubEventHandler;
  streamId?: string;
  onlyType?: 'job_update' | 'organization_update';
};

export const STREAM_HUB_EVENT_TYPES = [
  'job_update',
  'organization_update',
  'folder_update',
  'usecase_update',
  'comment_update',
  'lock_update',
  'presence_update',
  'workspace_update',
  'workspace_membership_update',
  'status',
  'reasoning_delta',
  'tool_call_start',
  'tool_call_delta',
  'tool_call_result',
  'content_delta',
  'error',
  'done',
  'ping',
] as const;

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
  setJobUpdates(key: string, onEvent: StreamHubEventHandler): void;
  setStream(key: string, streamId: string, onEvent: StreamHubEventHandler): void;
  delete(key: string): void;
};
