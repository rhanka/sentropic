import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createConversationAuthority, IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import type { AuthUser } from '../../middleware/auth';
import { getCmIdentity } from './cm-identity';
import { runCmIdentityWrite } from './cm-transaction';

type VerifiedCaller = Readonly<Pick<AuthUser, 'userId' | 'workspaceId' | 'sessionId'>>;
const caller = new AsyncLocalStorage<VerifiedCaller>();
const conversationTtlSeconds = 7 * 24 * 60 * 60;

/** Only the authenticated HTTP root installs this context; jobs carry no login credential. */
export const withCmConversationCaller = <T>(user: AuthUser | undefined, operation: () => Promise<T>): Promise<T> => {
  if (!user?.userId || !user.workspaceId || !user.sessionId) return operation();
  return caller.run(Object.freeze({ userId: user.userId, workspaceId: user.workspaceId, sessionId: user.sessionId }), operation);
};

/** Explicit admission after a business chat exists and before its first job is published. */
export async function admitCmBusinessConversation(chatSessionId: string): Promise<boolean> {
  const verified = caller.getStore();
  if (!verified?.userId || !verified.workspaceId || !verified.sessionId) return false;
  const prospectiveId = randomUUID(); // An id hint only; stable across callback retries.
  try {
    return await runCmIdentityWrite(async tx => {
      await tx.lockSubject(verified.userId);
      await tx.lockWorkspace(verified.workspaceId);
      const result = await tx.hostTransaction.query<{
        user_id: string; workspace_id: string | null; cm_conversation_session_id: string | null;
      }>(`SELECT user_id, workspace_id, cm_conversation_session_id FROM public.chat_sessions WHERE id = $1 FOR UPDATE`, [chatSessionId]);
      const chat = result.rows[0];
      if (!chat || chat.user_id !== verified.userId || chat.workspace_id !== verified.workspaceId) return false;
      const now = new Date().toISOString();
      const fresh = await getCmIdentity().decision.decide({ inputKind: 'first_party_http',
        userId: verified.userId, workspaceId: verified.workspaceId, sessionId: verified.sessionId }, now);
      if (!fresh.decision.allow) return false; // Q-G: chat may continue with an empty tool set.
      if (chat.cm_conversation_session_id !== null) {
        const existing = await tx.conversations.findSession(chat.cm_conversation_session_id);
        return Boolean(existing && existing.userId === verified.userId && existing.workspaceId === verified.workspaceId
          && existing.status === 'active' && existing.expiresAt > now);
      }
      await createConversationAuthority({ sessions: tx.conversations, audit: tx.stores.audit }).openSession({
        conversationSessionId: prospectiveId, userId: verified.userId, workspaceId: verified.workspaceId,
      }, { now, ttlSeconds: conversationTtlSeconds });
      const updated = await tx.hostTransaction.query(`UPDATE public.chat_sessions SET cm_conversation_session_id = $1
        WHERE id = $2 AND cm_conversation_session_id IS NULL`, [prospectiveId, chatSessionId]);
      if (updated.rowCount !== 1) throw new IdentityCustodyErrorV1('identity_record_conflict');
      return true;
    });
  } catch (error) {
    if (error instanceof IdentityCustodyErrorV1 && error.code === 'identity_transaction_indeterminate') {
      throw new IdentityCustodyErrorV1('identity_transaction_indeterminate');
    }
    throw new Error('conversation_authority_unavailable');
  }
}

/** Removing the business handle also retires its CM authority in the same commit. */
export const deleteCmBusinessConversation = (chatSessionId: string, userId: string): Promise<void> =>
  runCmIdentityWrite(async tx => {
    const discovered = await tx.hostTransaction.query<{ workspace_id: string | null }>(
      'SELECT workspace_id FROM public.chat_sessions WHERE id = $1 AND user_id = $2', [chatSessionId, userId]);
    if (!discovered.rows[0]) return;
    await tx.lockSubject(userId);
    const workspaceId = discovered.rows[0].workspace_id;
    if (workspaceId) await tx.lockWorkspace(workspaceId);
    const locked = await tx.hostTransaction.query<{
      workspace_id: string | null; cm_conversation_session_id: string | null;
    }>('SELECT workspace_id, cm_conversation_session_id FROM public.chat_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [chatSessionId, userId]);
    const chat = locked.rows[0];
    if (!chat) return;
    if (chat.workspace_id !== workspaceId) throw new IdentityCustodyErrorV1('identity_record_conflict');
    if (chat.cm_conversation_session_id) {
      const record = await tx.conversations.findSession(chat.cm_conversation_session_id);
      if (!record || record.userId !== userId || record.workspaceId !== workspaceId) {
        throw new IdentityCustodyErrorV1('identity_material_invalid');
      }
      await createConversationAuthority({ sessions: tx.conversations, audit: tx.stores.audit })
        .revokeSession(record.conversationSessionId, userId);
    }
    await tx.hostTransaction.query('DELETE FROM public.chat_sessions WHERE id = $1 AND user_id = $2', [chatSessionId, userId]);
  });
