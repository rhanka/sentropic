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
  configured?: ControllerPollJob,
): ControllerPollJob => {
  if (configured) return configured;
  if (transport && typeof transport === 'object') {
    const candidate = (transport as { pollJob?: unknown }).pollJob;
    if (typeof candidate === 'function') {
      return candidate.bind(transport) as ControllerPollJob;
    }
  }
  return async () => ({ status: undefined });
};

const sameHostRefs = (
  left: HostRefs | null,
  right: ChatSessionRuntimeHost,
): boolean =>
  Boolean(left) &&
  left!.transport === right.transport &&
  left!.streamClient === right.streamClient &&
  left!.checkpointHost === right.checkpointHost &&
  left!.localToolMachine === right.localToolMachine;

export function createChatSessionRuntime<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
>(
  sessionId: string,
  config: ChatSessionRuntimeConfig<Message> = {},
): ChatSessionRuntime<Message> {
  const controller = createChatLoopController<Message, unknown>();
  const listeners = new Set<(s: ChatSessionSnapshot<Message>) => void>();

  assertString(sessionId, 'sessionId');
  assertString(config.initialDraft ?? '', 'initialDraft');
  assertJsonSafe(config.initialMessages ?? [], 'initialMessages');
  assertJsonSafe(config.initialAttachments ?? [], 'initialAttachments');
  assertJsonSafe(config.initialCheckpoints ?? [], 'initialCheckpoints');
  assertJsonSafe(config.initialTodo ?? null, 'initialTodo');
  if (config.initialLastAppliedSequence !== undefined) {
    assertFiniteNumber(config.initialLastAppliedSequence, 'initialLastAppliedSequence');
  }

  let currentSessionId = sessionId;
  let draftState = createDraftState(config.initialDraft ?? '');
  let attachments: ChatSessionAttachment[] = cloneMutableValue([
    ...(config.initialAttachments ?? []),
  ]);
  let checkpoints: ChatSessionCheckpoint[] = cloneMutableValue([
    ...(config.initialCheckpoints ?? []),
  ]);
  let todo: ChatSessionTodo | null = cloneMutableValue(config.initialTodo ?? null);
  let lastAppliedSequence = normalizeSequence(
    config.initialLastAppliedSequence ?? 0,
  );
  let attachGeneration = 0;
  let attachedRefs: HostRefs | null = null;
  let streamAttached = false;
  let viewBindings = 0;
  let disposed = false;
  let controllerUnsubscribe: (() => void) | null = null;

  const readMaxAppliedSequence = (): number => {
    const loop = controller.getSnapshot();
    let max = 0;
    for (const message of loop.messages) {
      const sequence = Number(message.sequence ?? 0);
      if (Number.isFinite(sequence)) max = Math.max(max, sequence);
    }
    for (const eventList of loop.initialEventsByMessageId.values()) {
      for (const event of eventList) {
        const sequence = Number(event.sequence ?? 0);
        if (Number.isFinite(sequence)) max = Math.max(max, sequence);
      }
    }
    for (const eventList of loop.projectedStreamEventsById.values()) {
      for (const event of eventList) {
        const sequence = Number(event.sequence ?? 0);
        if (Number.isFinite(sequence)) max = Math.max(max, sequence);
      }
    }
    return normalizeSequence(max);
  };

  const syncLastAppliedSequenceFromController = (): void => {
    lastAppliedSequence = Math.max(lastAppliedSequence, readMaxAppliedSequence());
  };

  const buildSnapshot = (): ChatSessionSnapshot<Message> => {
    const loop = controller.getSnapshot();

    return Object.freeze({
      sessionId: currentSessionId,
      messages: cloneSnapshotValue(loop.messages),
      projectedTimelineItems: cloneSnapshotValue(loop.projectedTimelineItems),
      draft: draftState.draft,
      input: draftState.input,
      attachments: cloneSnapshotValue(attachments),
      attachmentSummary: cloneSnapshotValue(summarizeAttachments(attachments)),
      checkpoints: cloneSnapshotValue(checkpoints),
      todo: cloneSnapshotValue(todo),
      pendingLocalToolPermissionPrompts: cloneSnapshotValue(
        loop.pendingLocalToolPermissionPrompts,
      ),
      lastAppliedSequence,
      attachGeneration,
      viewBindings,
      disposed,
    });
  };

  const notify = (): void => {
    if (listeners.size === 0) return;
    const current = buildSnapshot();
    for (const cb of [...listeners]) {
      try {
        cb(current);
      } catch {
        // Isolate subscribers: one view bridge must not break the runtime.
      }
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error('ChatSessionRuntime is disposed');
    }
  };

  controllerUnsubscribe = controller.subscribe(() => {
    syncLastAppliedSequenceFromController();
    if (!disposed) notify();
  });

  if (config.initialMessages && config.initialMessages.length > 0) {
    controller.setMessages(cloneMessages(config.initialMessages));
  }

  const setDraft = (value: string): void => {
    assertActive();
    assertString(value, 'draft');
    draftState = syncDraftFromInput({
      mode: 'ai',
      direction: 'input',
      draft: draftState.draft,
      input: value,
      lastDraftApplied: draftState.lastDraftApplied,
    });
    notify();
  };

  const setAttachments = (next: readonly ChatSessionAttachment[]): void => {
    assertActive();
    assertJsonSafe(next, 'attachments');
    attachments = cloneMutableValue([...next]);
    notify();
  };

  const setMessages = (messages: readonly Message[]): void => {
    assertActive();
    assertJsonSafe(messages, 'messages');
    controller.setMessages(cloneMessages(messages));
  };

  const appendMessage = (message: Message): void => {
    assertActive();
    assertJsonSafe(message, 'message');
    controller.appendMessage(cloneMutableValue(message));
  };

  const hydrateMessages = (
    messages: readonly Message[],
    meta?: Pick<SessionHistoryMetaLine, 'checkpoints' | 'todoRuntime'>,
  ): void => {
    assertActive();
    assertJsonSafe(messages, 'messages');
    if (meta?.checkpoints !== undefined) {
      assertJsonSafe(meta.checkpoints, 'checkpoints');
    }
    if (Object.prototype.hasOwnProperty.call(meta ?? {}, 'todoRuntime')) {
      assertJsonSafe(meta?.todoRuntime ?? null, 'todo');
    }
    if (meta?.checkpoints) {
      checkpoints = cloneMutableValue([
        ...meta.checkpoints,
      ]) as ChatSessionCheckpoint[];
    }
    if (Object.prototype.hasOwnProperty.call(meta ?? {}, 'todoRuntime')) {
      todo = cloneMutableValue(meta?.todoRuntime ?? null) as ChatSessionTodo | null;
    }

    let next = cloneMessages(controller.getSnapshot().messages);
    for (const message of messages) {
      const normalized = normalizeHydratedMessage(cloneMutableValue(message));
      if (normalized._localStatus === undefined) delete normalized._localStatus;
      assertJsonSafe(normalized, 'messages');
      next = upsertSequencedMessage(next, normalized);
    }
    controller.setMessages(next);
  };

  const setCheckpoints = (next: readonly ChatSessionCheckpoint[]): void => {
    assertActive();
    assertJsonSafe(next, 'checkpoints');
    checkpoints = cloneMutableValue([...next]);
    notify();
  };

  const setTodo = (next: ChatSessionTodo | null): void => {
    assertActive();
    assertJsonSafe(next, 'todo');
    todo = cloneMutableValue(next);
    notify();
  };

  const setLastAppliedSequence = (sequence: number): void => {
    assertActive();
    assertFiniteNumber(sequence, 'lastAppliedSequence');
    lastAppliedSequence = normalizeSequence(sequence);
    notify();
  };

  const attach = (host: ChatSessionRuntimeHost): void => {
    assertActive();
    if (sameHostRefs(attachedRefs, host)) return;

    if (host.streamClient !== undefined && !isControllerStreamClient(host.streamClient)) {
      throw new Error(
        'ChatSessionRuntime.attach requires streamClient.set/delete',
      );
    }

    if (streamAttached) {
      controller.detachStream();
      streamAttached = false;
    }
    if (attachedRefs) controller.detachLocalToolMachine();

    attachGeneration += 1;
    const generation = attachGeneration;
    attachedRefs = {
      transport: host.transport,
      streamClient: host.streamClient,
      checkpointHost: host.checkpointHost,
      localToolMachine: host.localToolMachine,
    };

    controller.attachHost({ transport: host.transport });
    if (host.localToolMachine) {
      controller.attachLocalToolMachine(host.localToolMachine);
    }

    if (host.streamClient !== undefined) {
      const streamClient = host.streamClient;
      controller.attachStream({
        streamClient: {
          set(key, onEvent) {
            streamClient.set(key, (event: unknown) => {
              onEvent(event);
              controller.handleLocalToolStreamEvent(event);
            });
          },
          delete(key) {
            streamClient.delete(key);
          },
        },
        pollJob: resolvePollJob(host.transport, config.pollJob),
        onProjectionEvent: (streamId) => {
          if (attachGeneration === generation) {
            config.onProjectionEvent?.(streamId);
          }
        },
        onTerminal: (streamId, outcome) => {
          if (attachGeneration === generation) {
            config.onTerminal?.(streamId, outcome);
          }
        },
        pollTimeoutMs: config.pollTimeoutMs,
        pollInitialDelayMs: config.pollInitialDelayMs,
        pollIntervalMs: config.pollIntervalMs,
      });
      streamAttached = true;
    }

    notify();
  };

  const bindView = (): (() => void) => {
    assertActive();
    let active = true;
    viewBindings += 1;
    notify();
    return () => {
      if (!active) return;
      active = false;
      viewBindings = Math.max(0, viewBindings - 1);
      notify();
    };
  };

  const serialize = (): ChatSessionSnapshotSerializable<Message> => {
    const current = buildSnapshot();
    const serialized = cloneMutableValue({
      sessionId: current.sessionId,
      messages: current.messages as readonly Message[],
      draft: current.draft,
      attachments: current.attachments,
      checkpoints: current.checkpoints,
      todo: current.todo,
      lastAppliedSequence: current.lastAppliedSequence,
    });
    assertJsonSafe(serialized, 'serialized session');
    return serialized;
  };

  const restore = (
    serialized: ChatSessionSnapshotSerializable<Message>,
  ): void => {
    assertActive();
    assertJsonSafe(serialized, 'restore snapshot');
    assertString(serialized.sessionId, 'restore snapshot.sessionId');
    assertArray(serialized.messages, 'restore snapshot.messages');
    assertString(serialized.draft, 'restore snapshot.draft');
    assertArray(serialized.attachments, 'restore snapshot.attachments');
    assertArray(serialized.checkpoints, 'restore snapshot.checkpoints');
    assertFiniteNumber(
      serialized.lastAppliedSequence,
      'restore snapshot.lastAppliedSequence',
    );
    if (attachedRefs || streamAttached) {
      throw new Error(
        'ChatSessionRuntime.restore requires a quiescent runtime',
      );
    }

    currentSessionId = serialized.sessionId;
    draftState = createDraftState(serialized.draft);
    attachments = cloneMutableValue([...serialized.attachments]);
    checkpoints = cloneMutableValue([...serialized.checkpoints]);
    todo = cloneMutableValue(serialized.todo);
    lastAppliedSequence = normalizeSequence(serialized.lastAppliedSequence);
    // Pending-tool cross-process restore is L0d — it needs a controller-owned serializable pending-tool descriptor API (absent today) + the backend tool-result idempotency contract.
    controller.resetLocalToolMachineState();
    controller.setMessages(cloneMessages(serialized.messages));
  };

  const send = async (
    payload: ControllerSendPayload,
    opts: ChatSessionSendOptions<Message>,
  ): Promise<void> => {
    assertActive();
    await controller.send(payload, opts);
  };

  const retry = async (
    messageId: string,
    opts: ChatSessionRetryOptions<Message>,
  ): Promise<void> => {
    assertActive();
    await controller.retry(messageId, opts);
  };

  const stop = async (messageId: string): Promise<void> => {
    assertActive();
    await controller.stop(messageId);
  };

  const edit = async (messageId: string, content: string): Promise<void> => {
    assertActive();
    await controller.edit(messageId, content);
  };

  const setFeedback = async (
    messageId: string,
    vote: 'up' | 'down' | 'clear',
  ): Promise<void> => {
    assertActive();
    await controller.setFeedback(messageId, vote);
  };

  const decideLocalToolPermission = async (
    prompt: ChatSessionPendingTool,
    decision: string,
  ): Promise<void> => {
    assertActive();
    await controller.decideLocalToolPermission(prompt, decision);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (streamAttached) {
      controller.detachStream();
      streamAttached = false;
    }
    controller.detachHost();
    controller.detachLocalToolMachine();
    attachedRefs = null;
    controllerUnsubscribe?.();
    controllerUnsubscribe = null;
    notify();
  };

  return {
    snapshot: buildSnapshot,
    subscribe(cb) {
      listeners.add(cb);
      cb(buildSnapshot());
      return () => {
        listeners.delete(cb);
      };
    },
    setDraft,
    setAttachments,
    setMessages,
    appendMessage,
    hydrateMessages,
    setCheckpoints,
    setTodo,
    setLastAppliedSequence,
    attach,
    bindView,
    send,
    retry,
    stop,
    edit,
    setFeedback,
    decideLocalToolPermission,
    serialize,
    restore,
    dispose,
  };
}
