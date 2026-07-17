import {
  summarizeComposerAttachments,
  type ChatComposerAttachmentDraft,
  type ComposerAttachmentSummary,
} from './chatAttachments.js';
import { syncDraftFromInput, type ChatDraftState } from './chatDraft.js';
import {
  createChatLoopController,
  type ControllerHostTransport,
  type ControllerLocalToolPermissionPrompt,
  type ControllerPollJob,
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

export type ChatSessionPendingTool = ControllerLocalToolPermissionPrompt;

export type ChatSessionRuntimeHost = {
  transport: unknown;
  streamClient?: unknown;
  checkpointHost?: unknown;
};

export type ChatSessionRuntimeConfig<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
> = {
  initialMessages?: readonly Message[];
  initialDraft?: string;
  initialAttachments?: readonly unknown[];
  initialCheckpoints?: readonly unknown[];
  initialTodo?: unknown | null;
  initialPendingTool?: ChatSessionPendingTool | null;
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
  readonly attachments: readonly unknown[];
  readonly attachmentSummary: ComposerAttachmentSummary;
  readonly checkpoints: readonly unknown[];
  readonly todo: unknown | null;
  readonly pendingTool: Readonly<ChatSessionPendingTool> | null;
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
  attachments: readonly unknown[];
  checkpoints: readonly unknown[];
  todo: unknown | null;
  pendingTool: ChatSessionPendingTool | null;
  lastAppliedSequence: number;
};

export type ChatSessionRuntime<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
> = {
  snapshot(): ChatSessionSnapshot<Message>;
  subscribe(cb: (s: ChatSessionSnapshot<Message>) => void): () => void;
  setDraft(value: string): void;
  setAttachments(attachments: readonly unknown[]): void;
  setMessages(messages: readonly Message[]): void;
  appendMessage(message: Message): void;
  hydrateMessages(
    messages: readonly Message[],
    meta?: Pick<SessionHistoryMetaLine, 'checkpoints' | 'todoRuntime'>,
  ): void;
  setCheckpoints(checkpoints: readonly unknown[]): void;
  setTodo(todo: unknown | null): void;
  setPendingTool(pendingTool: ChatSessionPendingTool | null): void;
  setLastAppliedSequence(sequence: number): void;
  attach(host: ChatSessionRuntimeHost): void;
  bindView(): () => void;
  serialize(): ChatSessionSnapshotSerializable<Message>;
  restore(snapshot: ChatSessionSnapshotSerializable<Message>): void;
  dispose(): void;
};

type HostRefs = {
  transport: unknown;
  streamClient: unknown;
  checkpointHost: unknown;
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
  attachments: readonly unknown[],
): ComposerAttachmentSummary =>
  summarizeComposerAttachments(
    attachments as readonly ChatComposerAttachmentDraft[],
  );

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
  left!.checkpointHost === right.checkpointHost;

export function createChatSessionRuntime<
  Message extends ChatSessionRuntimeMessage = ChatSessionRuntimeMessage,
>(
  sessionId: string,
  config: ChatSessionRuntimeConfig<Message> = {},
): ChatSessionRuntime<Message> {
  const controller = createChatLoopController<Message, unknown>();
  const listeners = new Set<(s: ChatSessionSnapshot<Message>) => void>();

  let draftState = createDraftState(config.initialDraft ?? '');
  let attachments: unknown[] = cloneMutableValue([
    ...(config.initialAttachments ?? []),
  ]);
  let checkpoints: unknown[] = cloneMutableValue([
    ...(config.initialCheckpoints ?? []),
  ]);
  let todo: unknown | null = cloneMutableValue(config.initialTodo ?? null);
  let pendingTool: ChatSessionPendingTool | null = cloneMutableValue(
    config.initialPendingTool ?? null,
  );
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
    const controllerPendingTool =
      loop.pendingLocalToolPermissionPrompts[0] ?? null;
    const effectivePendingTool = pendingTool ?? controllerPendingTool;

    return Object.freeze({
      sessionId,
      messages: cloneSnapshotValue(loop.messages),
      projectedTimelineItems: cloneSnapshotValue(loop.projectedTimelineItems),
      draft: draftState.draft,
      input: draftState.input,
      attachments: cloneSnapshotValue(attachments),
      attachmentSummary: summarizeAttachments(attachments),
      checkpoints: cloneSnapshotValue(checkpoints),
      todo: cloneSnapshotValue(todo),
      pendingTool: cloneSnapshotValue(effectivePendingTool),
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
    draftState = syncDraftFromInput({
      mode: 'ai',
      direction: 'input',
      draft: draftState.draft,
      input: value,
      lastDraftApplied: draftState.lastDraftApplied,
    });
    notify();
  };

  const setAttachments = (next: readonly unknown[]): void => {
    assertActive();
    attachments = cloneMutableValue([...next]);
    notify();
  };

  const setMessages = (messages: readonly Message[]): void => {
    assertActive();
    controller.setMessages(cloneMessages(messages));
  };

  const appendMessage = (message: Message): void => {
    assertActive();
    controller.appendMessage(cloneMutableValue(message));
  };

  const hydrateMessages = (
    messages: readonly Message[],
    meta?: Pick<SessionHistoryMetaLine, 'checkpoints' | 'todoRuntime'>,
  ): void => {
    assertActive();
    if (meta?.checkpoints) {
      checkpoints = cloneMutableValue([...meta.checkpoints]);
    }
    if (Object.prototype.hasOwnProperty.call(meta ?? {}, 'todoRuntime')) {
      todo = cloneMutableValue(meta?.todoRuntime ?? null);
    }

    let next = cloneMessages(controller.getSnapshot().messages);
    for (const message of messages) {
      const normalized = normalizeHydratedMessage(cloneMutableValue(message));
      next = upsertSequencedMessage(next, normalized);
    }
    controller.setMessages(next);
  };

  const setCheckpoints = (next: readonly unknown[]): void => {
    assertActive();
    checkpoints = cloneMutableValue([...next]);
    notify();
  };

  const setTodo = (next: unknown | null): void => {
    assertActive();
    todo = cloneMutableValue(next);
    notify();
  };

  const setPendingTool = (next: ChatSessionPendingTool | null): void => {
    assertActive();
    pendingTool = cloneMutableValue(next);
    notify();
  };

  const setLastAppliedSequence = (sequence: number): void => {
    assertActive();
    lastAppliedSequence = normalizeSequence(sequence);
    notify();
  };

  const attach = (host: ChatSessionRuntimeHost): void => {
    assertActive();
    if (sameHostRefs(attachedRefs, host)) return;

    if (streamAttached) {
      controller.detachStream();
      streamAttached = false;
    }

    attachGeneration += 1;
    const generation = attachGeneration;
    attachedRefs = {
      transport: host.transport,
      streamClient: host.streamClient,
      checkpointHost: host.checkpointHost,
    };

    controller.attachHost({ transport: host.transport as ControllerHostTransport });

    if (host.streamClient !== undefined) {
      if (!isControllerStreamClient(host.streamClient)) {
        throw new Error(
          'ChatSessionRuntime.attach requires streamClient.set/delete',
        );
      }
      controller.attachStream({
        streamClient: host.streamClient,
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
    return cloneMutableValue({
      sessionId: current.sessionId,
      messages: current.messages as readonly Message[],
      draft: current.draft,
      attachments: current.attachments,
      checkpoints: current.checkpoints,
      todo: current.todo,
      pendingTool: current.pendingTool as ChatSessionPendingTool | null,
      lastAppliedSequence: current.lastAppliedSequence,
    });
  };

  const restore = (
    serialized: ChatSessionSnapshotSerializable<Message>,
  ): void => {
    assertActive();
    if (attachedRefs || streamAttached) {
      throw new Error(
        'ChatSessionRuntime.restore requires a quiescent runtime',
      );
    }

    draftState = createDraftState(serialized.draft);
    attachments = cloneMutableValue([...serialized.attachments]);
    checkpoints = cloneMutableValue([...serialized.checkpoints]);
    todo = cloneMutableValue(serialized.todo);
    pendingTool = cloneMutableValue(serialized.pendingTool);
    lastAppliedSequence = normalizeSequence(serialized.lastAppliedSequence);
    controller.setMessages(cloneMessages(serialized.messages));
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
    setPendingTool,
    setLastAppliedSequence,
    attach,
    bindView,
    serialize,
    restore,
    dispose,
  };
}
