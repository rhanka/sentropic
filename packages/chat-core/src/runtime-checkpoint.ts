/**
 * BR14b Lot 22b-1 — First step of the `ChatRuntime` god-class split.
 *
 * `ChatRuntimeCheckpoint` owns the three checkpoint orchestration
 * methods (`createCheckpoint` / `listCheckpoints` / `restoreCheckpoint`)
 * that were migrated into `ChatRuntime` in BR14b Lot 11. The bodies are
 * a VERBATIM move from `runtime.ts`; only the surrounding class changes.
 *
 * Pattern: each sub-class receives the same `ChatRuntimeDeps` by
 * reference (no copy, no state duplication). The `ChatRuntime` façade
 * instantiates one of these per `ChatRuntime` and delegates the public
 * checkpoint methods through one-line wrappers. All public method
 * signatures on `ChatRuntime` stay byte-for-byte identical so that
 * `chat-service.ts` call sites and the 6 checkpoint unit tests
 * (`tests/runtime-checkpoint.test.ts`) continue to work unchanged.
 *
 * The composite-key encoder + snapshot projector helpers stay in
 * `runtime.ts` (now `export const`) so the migration tooling lint stub
 * for `parseChatCheckpointKey` keeps its symmetry with
 * `encodeChatCheckpointKey` in a single file.
 *
 * Per Lot 22b-0 Section D — no cross-sub-class `this.<method>` calls:
 * the 3 checkpoint methods only touch `this.deps.{messageStore,
 * sessionStore, checkpointStore}` and the imported module helpers.
 */
import { randomUUID } from 'node:crypto';

import type { ChatState, ChatStateSnapshot } from './types.js';
import type {
  ChatCheckpointSummary,
  ChatRuntimeDeps,
  CreateCheckpointOptions,
  ListCheckpointsOptions,
  RestoreCheckpointOptions,
  RestoreCheckpointResult,
} from './runtime.js';
import {
  encodeChatCheckpointKey,
  snapshotMessageFromRow,
  summaryFromSnapshot,
} from './runtime.js';

export class ChatRuntimeCheckpoint {
  constructor(private readonly deps: ChatRuntimeDeps) {}

  /**
   * Create a checkpoint of the current session state, anchored at a
   * specific message (defaults to the latest message). Composes
   * `MessageStore.listForSession` (read all messages, ordered by
   * sequence) + `CheckpointStore.save` (persist the snapshot under
   * key `${sessionId}#${checkpointId}`).
   *
   * Migrated verbatim from
   * `PostgresChatCheckpointAdapter.createCheckpointForSession`
   * (BR14b Lot 4). Differences are limited to:
   *   (a) `db.select(...).from(chatMessages).where(...).orderBy(...)`
   *       becomes `this.deps.messageStore.listForSession(sessionId)`
   *       which already SELECTs the full column set ordered by
   *       `sequence ASC`;
   *   (b) `db.insert(chatContexts).values(...)` becomes
   *       `this.deps.checkpointStore.save(key, state)` — the adapter
   *       owns the table mapping;
   *   (c) Caller (chat-service.ts) is responsible for the
   *       session-owner authz check (`getSessionForUser`) before
   *       invoking this method; the runtime does not enforce it
   *       because the persistence layer is tenant-agnostic by design.
   */
  async createCheckpoint(
    options: CreateCheckpointOptions,
  ): Promise<ChatCheckpointSummary> {
    const messages = await this.deps.messageStore.listForSession(
      options.sessionId,
    );

    if (messages.length === 0) {
      throw new Error('Cannot create checkpoint on an empty session');
    }

    const anchorMessage =
      (options.anchorMessageId
        ? messages.find((message) => message.id === options.anchorMessageId)
        : null) ?? messages[messages.length - 1];
    if (!anchorMessage) throw new Error('Anchor message not found');

    const anchorSequence = Number(anchorMessage.sequence ?? 0);
    if (!Number.isFinite(anchorSequence) || anchorSequence <= 0) {
      throw new Error('Invalid checkpoint anchor sequence');
    }

    const snapshotMessages = messages
      .filter((message) => Number(message.sequence ?? 0) <= anchorSequence)
      .map(snapshotMessageFromRow);

    const checkpointId = randomUUID();
    const now = new Date();
    const title =
      typeof options.title === 'string' && options.title.trim().length > 0
        ? options.title.trim()
        : `Checkpoint #${anchorSequence}`;

    const snapshot: ChatStateSnapshot = {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      messages: snapshotMessages,
    };

    const state: ChatState = {
      sessionId: options.sessionId,
      snapshot,
      modifications: {
        action: 'checkpoint_create',
        anchorMessageId: anchorMessage.id,
        anchorSequence,
      },
      createdAt: now.toISOString(),
    };

    await this.deps.checkpointStore.save(
      encodeChatCheckpointKey(options.sessionId, checkpointId),
      state,
    );

    return {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      createdAt: now.toISOString(),
    };
  }

  /**
   * List checkpoints for a session, newest first. Composes
   * `CheckpointStore.list(prefix=sessionId, limit)` to retrieve the
   * meta rows and `CheckpointStore.load(key)` per row to reconstruct
   * the `ChatCheckpointSummary` shape (title, anchorMessageId,
   * anchorSequence, messageCount) that the chat surface expects.
   *
   * Migrated verbatim from
   * `PostgresChatCheckpointAdapter.listCheckpointsForSession`
   * (BR14b Lot 4). Difference: the previous implementation issued a
   * single SQL SELECT that returned the snapshot JSONB inline.
   * The generic port's `list` returns only `CheckpointMeta` (key +
   * version + timestamps); reconstructing the rich summary requires
   * a follow-up `load(key)` per row. For the chat domain's default
   * `limit=20` cap this is acceptable; if a future workload reveals
   * a hot path we can revisit by extending the port or introducing
   * a dedicated `summaries(prefix, limit)` overload.
   *
   * Behavior preservation: output shape is byte-for-byte identical
   * to the legacy implementation; ordering (newest first by
   * createdAt) is preserved by the adapter's `list` ORDER BY.
   */
  async listCheckpoints(
    options: ListCheckpointsOptions,
  ): Promise<ChatCheckpointSummary[]> {
    const metas = await this.deps.checkpointStore.list(
      options.sessionId,
      options.limit,
    );

    const summaries: ChatCheckpointSummary[] = [];
    for (const meta of metas) {
      const loaded = await this.deps.checkpointStore.load(meta.key);
      if (!loaded) continue;
      summaries.push(summaryFromSnapshot(loaded.state.snapshot, meta.createdAt));
    }
    return summaries;
  }

  /**
   * Restore a checkpoint by truncating all messages strictly above
   * its anchor sequence and touching the session `updatedAt`.
   * Composes `CheckpointStore.load` (read snapshot to extract
   * anchorSequence) + `MessageStore.deleteAfterSequence` (truncate)
   * + `SessionStore.touchUpdatedAt` (bump session timestamp).
   *
   * Migrated verbatim from
   * `PostgresChatCheckpointAdapter.restoreCheckpointForSession`
   * (BR14b Lot 4). Differences are limited to:
   *   (a) `db.select(...).from(chatContexts).where(id+sessionId+type)`
   *       becomes `this.deps.checkpointStore.load(key)`;
   *   (b) `db.delete(chatMessages).where(sessionId+sequence>anchor)`
   *       becomes `this.deps.messageStore.deleteAfterSequence(...)`;
   *   (c) `db.update(chatSessions).set({updatedAt})` becomes
   *       `this.deps.sessionStore.touchUpdatedAt(sessionId)`;
   *   (d) The `removedMessages` count: the legacy adapter used
   *       `RETURNING { id }` to count deleted rows. The
   *       `MessageStore.deleteAfterSequence` port returns void; we
   *       compute the count up-front by listing messages with
   *       `sequence > anchorSequence` via `listForSession` then
   *       filtering — same value, one extra read. Chat sessions are
   *       small (tens to low hundreds of messages typically) so the
   *       cost is negligible. This preserves the public API's
   *       `removedMessages` contract.
   */
  async restoreCheckpoint(
    options: RestoreCheckpointOptions,
  ): Promise<RestoreCheckpointResult> {
    const key = encodeChatCheckpointKey(
      options.sessionId,
      options.checkpointId,
    );
    const loaded = await this.deps.checkpointStore.load(key);
    if (!loaded) throw new Error('Checkpoint not found');

    const restoredToSequence = Number(loaded.state.snapshot.anchorSequence ?? 0);
    if (!Number.isFinite(restoredToSequence) || restoredToSequence <= 0) {
      throw new Error('Invalid checkpoint payload');
    }

    const messages = await this.deps.messageStore.listForSession(
      options.sessionId,
    );
    const removedMessages = messages.filter(
      (message) => Number(message.sequence ?? 0) > restoredToSequence,
    ).length;

    await this.deps.messageStore.deleteAfterSequence(
      options.sessionId,
      restoredToSequence,
    );
    await this.deps.sessionStore.touchUpdatedAt(options.sessionId);

    return {
      checkpointId: options.checkpointId,
      restoredToSequence,
      removedMessages,
    };
  }
}
