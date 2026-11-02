import { chatService } from '../../src/services/chat-service';
import { createSession } from '../../src/services/session-manager';
import { admitCmBusinessConversation, withCmConversationCaller } from '../../src/services/identity/cm-conversation-authority';

/** Exercise the real HTTP admission boundary for service-level chat fixtures. */
export async function createAdmittedChatMessage(
  input: Parameters<typeof chatService.createUserMessageWithAssistantPlaceholder>[0],
) {
  if (!input.workspaceId) throw new Error('Chat fixture requires an explicit workspace');
  const login = await createSession(input.userId, 'editor', { name: 'CM chat fixture' });
  const created = await chatService.createUserMessageWithAssistantPlaceholder(input);
  const admitted = await withCmConversationCaller({ userId: input.userId, workspaceId: input.workspaceId,
    sessionId: login.sessionId, role: 'editor' }, () => admitCmBusinessConversation(created.sessionId));
  if (!admitted) throw new Error('CM refused chat fixture admission');
  return created;
}
