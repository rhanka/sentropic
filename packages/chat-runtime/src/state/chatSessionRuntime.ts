import {
  summarizeComposerAttachments,
  type ChatComposerAttachmentDraft,
  type ComposerAttachmentSummary,
} from './chatAttachments.js';
import { syncDraftFromInput, type ChatDraftState } from './chatDraft.js';
import {
  createChatLoopController,
  type AttachLocalToolMachineOptions,
  type ChatLoopController,
  type ControllerHostTransport,
  type ControllerLocalToolPermissionPrompt,
  type ControllerPollJob,
  type ControllerSendPayload,
  type ControllerStreamClient,
  type ControllerStreamEvent,
  type SendSteerOptions,
} from './chatLoopController.js';
import type {
  ChatProjectedTimelineItem,
  ChatProjectionMessage,
} from './chatProjection.js';
import {
  normalizeHydratedMessage,
  upsertSequencedMessage,
  type SessionHistoryMetaLine,
} from './chatSessionHydration.js';

export type ChatSessionRuntimeMessage = ChatProjectionMessage & {
  sessionId?: string;
  createdAt?: string;
  sequence?: number | string | null;
  [key: string]: unknown;
};

export type ChatSessionJsonPrimitive = string | number | boolean | null;

export type ChatSessionJsonValue =
  | ChatSessionJsonPrimitive
  | ChatSessionJsonValue[]
  | { [key: string]: ChatSessionJsonValue };

export type ChatSessionJsonObject = {
  [key: string]: ChatSessionJsonValue;
};

export type ChatSessionAttachment = ChatComposerAttachmentDraft;
export type ChatSessionCheckpoint = ChatSessionJsonObject;
export type ChatSessionTodo = ChatSessionJsonObject;
export type ChatSessionPendingTool = ControllerLocalToolPermissionPrompt;

export type ChatSessionRuntimeHost = {
  transport: ControllerHostTransport;
  streamClient?: ControllerStreamClient;
  checkpointHost?: unknown;
  localToolMachine?: AttachLocalToolMachineOptions;
};

export type ChatSessionRuntimeConfig<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
> = {
  initialMessages?: readonly Message[];
  initialDraft?: string;
  initialAttachments?: readonly ChatSessionAttachment[];
  initialCheckpoints?: readonly ChatSessionCheckpoint[];
  initialTodo?: ChatSessionTodo | null;
  initialLastAppliedSequence?: number;
  pollJob?: ControllerPollJob;
  pollTimeoutMs?: number;
  pollInitialDelayMs?: number;
  pollIntervalMs?: number;
  onProjectionEvent?: (streamId: string) => void;
  onTerminal?: (streamId: string, outcome: 'done' | 'error') => void;
};

export type ChatSessionSnapshot<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
> = {
  readonly sessionId: string;
  readonly messages: readonly Readonly<Message>[];
  readonly projectedTimelineItems: readonly ChatProjectedTimelineItem<Message, unknown>[];
  readonly draft: string;
  readonly input: string;
  readonly attachments: readonly Readonly<ChatSessionAttachment>[];
  readonly attachmentSummary: ComposerAttachmentSummary;
  readonly checkpoints: readonly Readonly<ChatSessionCheckpoint>[];
  readonly todo: Readonly<ChatSessionTodo> | null;
  readonly pendingLocalToolPermissionPrompts: readonly Readonly<ChatSessionPendingTool>[];
  readonly lastAppliedSequence: number;
  readonly attachGeneration: number;
  readonly viewBindings: number;
  readonly disposed: boolean;
};

export type ChatSessionSnapshotSerializable<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
> = {
  sessionId: string;
  messages: readonly Message[];
  draft: string;
  attachments: readonly ChatSessionAttachment[];
  checkpoints: readonly ChatSessionCheckpoint[];
  todo: ChatSessionTodo | null;
  lastAppliedSequence: number;
};

type ChatSessionSendOptions<
  Message extends ChatSessionRuntimeMessage,
> = Parameters<ChatLoopController<Message, unknown>['send']>[1];

type ChatSessionRetryOptions<
  Message extends ChatSessionRuntimeMessage,
> = Parameters<ChatLoopController<Message, unknown>['retry']>[1];

export type ChatSessionRuntime<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
> = {
  snapshot(): ChatSessionSnapshot<Message>;
  subscribe(cb: (s: ChatSessionSnapshot<Message>) => void): () => void;
  setDraft(value: string): void;
  setAttachments(attachments: readonly ChatSessionAttachment[]): void;
  setMessages(messages: readonly Message[]): void;
  appendMessage(message: Message): void;
  hydrateMessages(
    messages: readonly Message[],
    meta?: Pick<SessionHistoryMetaLine, 'checkpoints' | 'todoRuntime'>,
  ): void;
  setCheckpoints(checkpoints: readonly ChatSessionCheckpoint[]): void;
  setTodo(todo: ChatSessionTodo | null): void;
  setLastAppliedSequence(sequence: number): void;
  attach(host: ChatSessionRuntimeHost): void;
  bindView(): () => void;
  send(payload: ControllerSendPayload, opts: ChatSessionSendOptions<Message>): Promise<void>;
  retry(messageId: string, opts: ChatSessionRetryOptions<Message>): Promise<void>;
  stop(messageId: string): Promise<void>;
  edit(messageId: string, content: string): Promise<void>;
  setFeedback(messageId: string, vote: 'up' | 'down' | 'clear'): Promise<void>;
  mergeHistoryEvents(messageId: string, events: ControllerStreamEvent[]): void;
  sendSteer(text: string, streamId: string, options: SendSteerOptions): Promise<void>;
  decideLocalToolPermission(
    prompt: ChatSessionPendingTool,
    decision: string,
  ): Promise<void>;
  serialize(): ChatSessionSnapshotSerializable<Message>;
  restore(snapshot: ChatSessionSnapshotSerializable<Message>): void;
  dispose(): void;
};

type HostRefs = {
  transport: ControllerHostTransport;
  streamClient: ControllerStreamClient | undefined;
  checkpointHost: unknown;
  localToolMachine: AttachLocalToolMachineOptions | undefined;
};

const createDraftState = (draft = ''): ChatDraftState => ({
  draft,
  input: draft,
  lastDraftApplied: draft,
});

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertJsonSafe = (
  value: unknown,
  label: string,
  ancestors = new Set<object>(),
): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new TypeError(`${label} must contain only finite JSON numbers`);
  }
  if (typeof value === 'undefined') {
    throw new TypeError(`${label} must not contain undefined values`);
  }
  if (typeof value !== 'object' || !value) {
    throw new TypeError(`${label} must contain only JSON-safe plain data`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} must not contain cyclic data`);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError(
      `${label} must contain only JSON-safe plain data (Map, Set, class, and host objects are not allowed)`,
    );
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertJsonSafe(entry, `${label}[${index}]`, ancestors),
    );
  } else {
    Object.entries(value).forEach(([key, entry]) =>
      assertJsonSafe(entry, `${label}.${key}`, ancestors),
    );
  }
  ancestors.delete(value);
};

const assertString: (
  value: unknown,
  label: string,
) => asserts value is string = (value, label) => {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`);
  }
};

const assertArray: (
  value: unknown,
  label: string,
) => asserts value is readonly unknown[] = (value, label) => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
};

const assertFiniteNumber: (
  value: unknown,
  label: string,
) => asserts value is number = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
};

const cloneMutableValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneMutableValue(item)) as T;
  }
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = cloneMutableValue(entry);
    }
    return next as T;
  }
  if (value !== null && typeof value === 'object') {
    throw new TypeError('value must contain only JSON-safe plain data');
  }
  return value;
};

const freezeSnapshotValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    for (const item of value) freezeSnapshotValue(item);
    return Object.freeze(value) as T;
  }
  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) freezeSnapshotValue(entry);
    return Object.freeze(value) as T;
  }
  return value;
};

const cloneSnapshotValue = <T>(value: T): T =>
  freezeSnapshotValue(cloneMutableValue(value));

const normalizeSequence = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const cloneMessages = <
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
>(
  messages: readonly Message[],
): Message[] => cloneMutableValue([...messages]);

const summarizeAttachments = (
  attachments: readonly ChatSessionAttachment[],
): ComposerAttachmentSummary => summarizeComposerAttachments(attachments);

const isControllerStreamClient = (
  value: unknown,
): value is ControllerStreamClient => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.set === 'function' && typeof record.delete === 'function';
};

const resolvePollJob = (
  transport: unknown,
