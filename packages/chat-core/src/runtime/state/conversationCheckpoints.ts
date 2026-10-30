import type { CheckpointHost, Checkpoint } from '../checkpoints/index.js';
import { getCheckpointMutationPreviewItems } from '../checkpoints/classifier.js';
import type { ChatSessionRuntime } from './chatSessionRuntime.js';

export type ConversationCheckpointPrompt = {
  kind: 'retry' | 'edit' | 'restore';
  checkpointId: string;
  messageId: string;
  mutations: string[];
};

/** The runtime owns mutation choices; hosts implement authorized checkpoint I/O. */
export function createConversationCheckpoints(session: ChatSessionRuntime, options: {
  host?: CheckpointHost;
  notify(): void;
  reload(): Promise<void>;
}) {
  let pending: { prompt: ConversationCheckpointPrompt; continueAction?: () => Promise<void> } | null = null;
  let busy = false;
  let disposed = false;
  const checkpointFor = (messageId: string) => session.snapshot().checkpoints.find((entry) => entry.anchorMessageId === messageId);
  const mutations = (checkpoint: Checkpoint) => {
    const current = session.snapshot();
    const events = new Map();
    for (const item of current.projectedTimelineItems) {
      if (item.kind !== 'message') events.set(item.streamId, [...(events.get(item.streamId) ?? []), ...item.segment.events]);
    }
    return getCheckpointMutationPreviewItems(checkpoint,
      current.messages.map((message) => ({ ...message, sequence: Number(message.sequence ?? 0) })), events, options.host);
  };
  return {
    snapshot: () => ({ prompt: pending?.prompt ?? null, busy,
      messageIds: options.host ? session.snapshot().checkpoints.map((entry) => String(entry.anchorMessageId ?? '')).filter(Boolean) : [] }),
    async create(messageId: string) {
      if (!options.host || disposed) return;
      const sessionId = session.snapshot().sessionId;
      await options.host.createCheckpoint(sessionId, messageId);
      const checkpoints = await options.host.fetchCheckpoints(sessionId);
      if (!disposed) session.setCheckpoints(checkpoints as Parameters<typeof session.setCheckpoints>[0]);
    },
    async request(kind: ConversationCheckpointPrompt['kind'], messageId: string, continueAction?: () => Promise<void>) {
      if (disposed || busy || pending) return;
      const checkpoint = checkpointFor(messageId) as Checkpoint | undefined;
      const preview = checkpoint && options.host ? mutations(checkpoint) : [];
      if (!checkpoint || !options.host || (kind !== 'restore' && !preview.length)) { await continueAction?.(); return; }
      pending = { prompt: { kind, checkpointId: checkpoint.id, messageId, mutations: preview }, continueAction };
      options.notify();
    },
    async decide(restore: boolean) {
      if (!pending || busy || disposed) return;
      const action = pending; busy = true; options.notify();
      try {
        if (restore) {
          if (!options.host) throw new Error('Checkpoint host unavailable');
          await options.host.restoreCheckpoint(session.snapshot().sessionId, action.prompt.checkpointId);
          if (disposed) return;
          await options.reload();
        }
        if (!disposed) { pending = null; await action.continueAction?.(); }
      } finally { busy = false; if (!disposed) options.notify(); }
    },
    dispose() { disposed = true; pending = null; },
  };
}
