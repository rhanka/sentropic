import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { chatContexts } from '../../db/schema';
import type {
  CheckpointMeta,
  CheckpointStore,
  SaveResult,
} from '../../../../packages/chat-core/src/checkpoint-port';
import type { ChatState } from '../../../../packages/chat-core/src/types';

export const CHAT_CHECKPOINT_CONTEXT_TYPE = 'chat_session_checkpoint';

/**
 * Composite key format used by the chat-checkpoint adapter:
 * `${sessionId}#${checkpointId}`. The `#` separator mirrors the
 * conventional path-fragment delimiter and is forbidden in our
 * createId() output (alphanumeric + dashes), guaranteeing
 * unambiguous parsing.
 *
 * The orchestration layer (`ChatRuntime.createCheckpoint` /
 * `listCheckpoints` / `restoreCheckpoint`) is responsible for
 * encoding/decoding keys and for resolving session-scoped
 * authorization upstream; the adapter does pure persistence.
 */
const KEY_SEPARATOR = '#';

const encodeKey = (sessionId: string, checkpointId: string): string =>
  `${sessionId}${KEY_SEPARATOR}${checkpointId}`;

const parseKey = (
  key: string,
): { sessionId: string; checkpointId: string } => {
  const idx = key.indexOf(KEY_SEPARATOR);
  if (idx <= 0 || idx === key.length - 1) {
    throw new Error(`Invalid chat checkpoint key: ${key}`);
  }
  return {
    sessionId: key.slice(0, idx),
    checkpointId: key.slice(idx + 1),
  };
};

/**
 * Per SPEC §12 — PostgresChatCheckpointAdapter implements the generic
 * `CheckpointStore<ChatState>` port with the `lenient` strategy:
 * `expectedVersion` mismatches are informational only, never blocking
 * (chat UX tolerates stale-write — restore-to-latest is acceptable).
 *
 * BR14b Lot 11: strict generic-port shape only. The session-aware
 * `createCheckpointForSession` / `listCheckpointsForSession` /
 * `restoreCheckpointForSession` orchestration that previously lived
 * on this adapter moved into `packages/chat-core/src/runtime.ts`
 * (`ChatRuntime.createCheckpoint` / `listCheckpoints` /
 * `restoreCheckpoint`) — the adapter is now pure persistence.
 *
 * Key format: `${sessionId}#${checkpointId}` — see `encodeKey` /
 * `parseKey` above. The orchestration layer is responsible for
 * encoding/decoding keys.
 *
 * Version semantics: always returns `version: 1` from `load` and
 * `save` because the `chat_contexts` table has no explicit version
 * column; the lenient strategy ignores `expectedVersion` entirely
 * (always succeeds, no `VersionMismatch` is produced).
 *
 * `tag` and `fork` are intentionally unimplemented — the chat domain
 * does not use them and the underlying schema has no labeling /
 * branching surface. Calling them throws so that any future feature
 * that needs them surfaces the gap immediately rather than silently
 * dropping metadata.
 */
export class PostgresChatCheckpointAdapter
  implements CheckpointStore<ChatState>
{
  async load(
    key: string,
  ): Promise<{ state: ChatState; version: number } | null> {
    const { sessionId, checkpointId } = parseKey(key);
    const [row] = await db
      .select({
        id: chatContexts.id,
        sessionId: chatContexts.sessionId,
        snapshotAfter: chatContexts.snapshotAfter,
        modifications: chatContexts.modifications,
        createdAt: chatContexts.createdAt,
      })
      .from(chatContexts)
      .where(
        and(
          eq(chatContexts.id, checkpointId),
          eq(chatContexts.sessionId, sessionId),
          eq(chatContexts.contextType, CHAT_CHECKPOINT_CONTEXT_TYPE),
        ),
      );

    if (!row) return null;

    const createdAtIso =
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(String(row.createdAt ?? '')).toISOString();

    const state: ChatState = {
      sessionId: row.sessionId,
      snapshot: row.snapshotAfter as ChatState['snapshot'],
      modifications: row.modifications as ChatState['modifications'],
      createdAt: createdAtIso,
    };

    return { state, version: 1 };
  }

  async save(
    key: string,
    state: ChatState,
    _expectedVersion?: number,
  ): Promise<SaveResult> {
    const { sessionId, checkpointId } = parseKey(key);
    if (state.sessionId !== sessionId) {
      throw new Error(
        'Checkpoint state.sessionId does not match key sessionId',
      );
    }

    const createdAt = new Date(state.createdAt);

    await db.insert(chatContexts).values({
      id: checkpointId,
      sessionId,
      contextType: CHAT_CHECKPOINT_CONTEXT_TYPE,
      contextId: checkpointId,
      snapshotBefore: null,
      snapshotAfter: state.snapshot,
      modifications: state.modifications,
      modifiedAt: createdAt,
      createdAt,
    });

    // Lenient strategy: expectedVersion is ignored; always succeed.
    return { version: 1, success: true };
  }

  async list(
    prefix?: string,
    limit?: number,
  ): Promise<ReadonlyArray<CheckpointMeta>> {
    const effectiveLimit = Number.isFinite(limit)
      ? Math.min(Math.max(Math.floor(limit as number), 1), 100)
      : 20;

    // Prefix is the sessionId (composite-key prefix before `#`). When
    // unset, listing all sessions is not supported in the chat domain;
    // we conservatively return empty rather than scanning the whole
    // table, mirroring the behavior of the previous session-scoped
    // implementation.
    if (!prefix) return [];

    const rows = await db
      .select({
        id: chatContexts.id,
        sessionId: chatContexts.sessionId,
        createdAt: chatContexts.createdAt,
        modifiedAt: chatContexts.modifiedAt,
      })
      .from(chatContexts)
      .where(
        and(
          eq(chatContexts.sessionId, prefix),
          eq(chatContexts.contextType, CHAT_CHECKPOINT_CONTEXT_TYPE),
        ),
      )
      .orderBy(desc(chatContexts.createdAt))
      .limit(effectiveLimit);

    return rows.map((row) => {
      const createdAtIso =
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(String(row.createdAt ?? '')).toISOString();
      const updatedAtIso =
        row.modifiedAt instanceof Date
          ? row.modifiedAt.toISOString()
          : row.modifiedAt
            ? new Date(String(row.modifiedAt)).toISOString()
            : createdAtIso;
      return {
        key: encodeKey(row.sessionId, row.id),
        version: 1,
        createdAt: createdAtIso,
        updatedAt: updatedAtIso,
      };
    });
  }

  async delete(key: string): Promise<void> {
    const { sessionId, checkpointId } = parseKey(key);
    await db
      .delete(chatContexts)
      .where(
        and(
          eq(chatContexts.id, checkpointId),
          eq(chatContexts.sessionId, sessionId),
          eq(chatContexts.contextType, CHAT_CHECKPOINT_CONTEXT_TYPE),
        ),
      );
  }

  async tag(_key: string, _label: string): Promise<void> {
    throw new Error('PostgresChatCheckpointAdapter.tag not implemented yet');
  }

  async fork(_sourceKey: string, _targetKey: string): Promise<void> {
    throw new Error('PostgresChatCheckpointAdapter.fork not implemented yet');
  }
}

/**
 * Helpers exported for `ChatRuntime` orchestration to encode/decode
 * the composite key without duplicating the format. Keeping the
 * adapter as the single owner of the key shape ensures that future
 * schema/key changes stay localized.
 */
export const encodeChatCheckpointKey = encodeKey;
export const parseChatCheckpointKey = parseKey;

export const postgresChatCheckpointAdapter = new PostgresChatCheckpointAdapter();
