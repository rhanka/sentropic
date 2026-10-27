import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { chatMessages, chatSessions, tenantMemberships, workspaces, workspaceMemberships } from '../../../src/db/schema';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../../utils/auth-helper';

vi.mock('../../../src/services/llm-runtime', () => ({ callLLMStream: vi.fn() }));
vi.mock('../../../src/services/artifacts/instance', () => ({ productArtifactTransport: {
  get ready() { return Promise.reject(new Error('private transport failure')); },
} }));
import { callLLMStream } from '../../../src/services/llm-runtime';
import { chatService } from '../../../src/services/chat-service';

describe('chat turn catalog capability', () => {
  let user: TestUser;
  beforeEach(async () => {
    vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '0');
    user = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({ userId: user.id, tenantId: 'sentropic', status: 'approved' });
    vi.mocked(callLLMStream).mockImplementation(async function* () {
      yield { type: 'content_delta', data: { delta: 'Chat continues.' } };
      yield { type: 'done', data: {} };
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(callLLMStream).mockReset();
    await cleanupAuthData();
  });

  it.each(['missing tenant membership', 'requested tenant membership', 'null session workspace',
    'hidden workspace', 'non-member', 'transport failure'])('should complete chat without catalog for %s', async denial => {
    const turn = await chatService.createUserMessageWithAssistantPlaceholder({ userId: user.id,
      workspaceId: user.workspaceId!, content: 'Hello', model: 'gpt-4.1-nano' });
    await db.update(chatSessions).set({ title: 'Capability test' }).where(eq(chatSessions.id, turn.sessionId));
    if (denial === 'missing tenant membership') await db.delete(tenantMemberships).where(eq(tenantMemberships.userId, user.id));
    if (denial === 'requested tenant membership') await db.update(tenantMemberships).set({ status: 'requested' }).where(eq(tenantMemberships.userId, user.id));
    if (denial === 'null session workspace') await db.update(chatSessions).set({ workspaceId: null }).where(eq(chatSessions.id, turn.sessionId));
    if (denial === 'hidden workspace') await db.update(workspaces).set({ hiddenAt: new Date() }).where(eq(workspaces.id, user.workspaceId!));
    if (denial === 'non-member') await db.delete(workspaceMemberships).where(eq(workspaceMemberships.userId, user.id));
    if (denial === 'transport failure') vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '1');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await chatService.runAssistantGeneration({ userId: user.id, ...turn });
    const calls = vi.mocked(callLLMStream).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].tools ?? []).toEqual([]);
    expect(calls[0][0].messages.find(message => message.role === 'system')?.content).toContain('catalog: unavailable');
    expect(warning.mock.calls).toContainEqual(['[chat] catalog: unavailable']);
    const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, turn.assistantMessageId));
    expect(message.content).toBe('Chat continues.');
  });
});
