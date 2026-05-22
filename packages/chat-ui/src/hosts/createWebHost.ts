import type { ChatCoreTransport } from '../client/transport.js';
import type { StreamHubClient } from '../client/streamTypes.js';
import {
  createRendererRegistry,
  type RendererRegistry,
} from '../renderers/registry.js';
import type { LocalToolsAdapter, WebHostAdapter } from './types.js';

export type ChatUiLabelValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

export type ChatUiLabelResolver = (
  key: string,
  options?: { values?: Record<string, ChatUiLabelValue> },
) => string;

export type ChatUiPanelRenderer = unknown;

export type ChatUiAuthAdapter = {
  getSession?: () => unknown;
  requireAuth?: () => Promise<unknown> | unknown;
};

export type ChatUiNavigationAdapter = {
  navigate?: (href: string) => Promise<void> | void;
};

export type ChatUiStorageAdapter = {
  get?: (key: string) => string | null | Promise<string | null>;
  set?: (key: string, value: string) => void | Promise<void>;
  remove?: (key: string) => void | Promise<void>;
};

export type ChatUiJobsHostAdapter = {
  renderPanel?: ChatUiPanelRenderer;
  activeJobsCount?: number | (() => number);
  failedJobsCount?: number | (() => number);
  queueTabLabel?: string;
  purgeMine?: () => Promise<void> | void;
};

export type ChatUiCommentsHostAdapter = {
  renderPanel?: ChatUiPanelRenderer;
  openThread?: (threadId: string) => Promise<void> | void;
  resolveSectionLabel?: (input: {
    type: string | null;
    key: string | null;
  }) => string | null;
};

export type ChatUiDocumentHostAdapter = {
  createSessionContext?: (sessionId: string, workspaceId?: string | null) => unknown;
  extractGeneratedFileCards?: (input: unknown) => unknown[];
  attachGoogleDriveFiles?: (
    sessionId: string,
    fileIds: readonly string[],
  ) => Promise<unknown> | unknown;
  downloadGeneratedFile?: (jobId: string) => Promise<void> | void;
};

export type ChatUiWebHost = WebHostAdapter & {
  transport: ChatCoreTransport;
  streamClient: StreamHubClient;
  labels: ChatUiLabelResolver;
  renderers: RendererRegistry;
  localTools?: LocalToolsAdapter;
  auth?: ChatUiAuthAdapter;
  navigation?: ChatUiNavigationAdapter;
  storage?: ChatUiStorageAdapter;
  contextProvider?: unknown;
  jobs?: ChatUiJobsHostAdapter;
  comments?: ChatUiCommentsHostAdapter;
  documents?: ChatUiDocumentHostAdapter;
};

export type CreateWebHostInput = {
  transport: ChatCoreTransport;
  streamClient: StreamHubClient;
  labels?: ChatUiLabelResolver;
  renderers?: RendererRegistry;
  localTools?: LocalToolsAdapter;
  auth?: ChatUiAuthAdapter;
  navigation?: ChatUiNavigationAdapter;
  storage?: ChatUiStorageAdapter;
  contextProvider?: unknown;
  jobs?: ChatUiJobsHostAdapter;
  comments?: ChatUiCommentsHostAdapter;
  documents?: ChatUiDocumentHostAdapter;
};

const defaultLabels: ChatUiLabelResolver = (key) => key;

const assertAdapter = (value: unknown, name: string): void => {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`createWebHost requires ${name}`);
  }
};

export const createWebHost = (input: CreateWebHostInput): ChatUiWebHost => {
  assertAdapter(input.transport, 'transport');
  assertAdapter(input.streamClient, 'streamClient');

  return {
    kind: 'web',
    transport: input.transport,
    streamClient: input.streamClient,
    labels: input.labels ?? defaultLabels,
    renderers: input.renderers ?? createRendererRegistry(),
    ...(input.localTools ? { localTools: input.localTools } : {}),
    ...(input.auth ? { auth: input.auth } : {}),
    ...(input.navigation ? { navigation: input.navigation } : {}),
    ...(input.storage ? { storage: input.storage } : {}),
    ...(input.contextProvider ? { contextProvider: input.contextProvider } : {}),
    ...(input.jobs ? { jobs: input.jobs } : {}),
    ...(input.comments ? { comments: input.comments } : {}),
    ...(input.documents ? { documents: input.documents } : {}),
  };
};
