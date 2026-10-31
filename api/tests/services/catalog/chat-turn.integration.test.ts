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
import { CHAT_COMMON_PROMPTS } from '../../../src/config/default-chat-system';

describe('chat turn catalog capability', () => {
  let user: TestUser;
  let evaluationTemplate: string;
  beforeEach(async () => {
    evaluationTemplate = CHAT_COMMON_PROMPTS.reasoning_effort_eval;
    CHAT_COMMON_PROMPTS.reasoning_effort_eval = '';
    vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '0');
    user = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({ userId: user.id, tenantId: 'sentropic', status: 'approved' });
    vi.mocked(callLLMStream).mockImplementation(async function* () {
      yield { type: 'content_delta', data: { delta: 'Chat continues.' } };
      yield { type: 'done', data: {} };
    });
  });
  afterEach(async () => {
    CHAT_COMMON_PROMPTS.reasoning_effort_eval = evaluationTemplate;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(callLLMStream).mockReset();
    await cleanupAuthData();
  });

  it('should isolate model tools for overlapping real-store turns in two workspaces', async () => {
    const other = await createAuthenticatedUser('guest');
    await db.insert(tenantMemberships).values({ userId: other.id, tenantId: 'sentropic', status: 'approved' });
    await db.update(workspaces).set({ type: 'ai-priorities' }).where(eq(workspaces.id, user.workspaceId!));
    await db.update(workspaces).set({ type: 'neutral' }).where(eq(workspaces.id, other.workspaceId!));
    const createTurn = async (actor: TestUser) => {
      const turn = await chatService.createUserMessageWithAssistantPlaceholder({ userId: actor.id,
        workspaceId: actor.workspaceId!, content: 'Hello', model: 'gpt-4.1-nano' });
      await db.update(chatSessions).set({ title: 'Isolation test' }).where(eq(chatSessions.id, turn.sessionId));
      return { userId: actor.id, ...turn };
    };
    const turns = await Promise.all([createTurn(user), createTurn(other)]);
    let release!: () => void;
    const bothModelsStarted = new Promise<void>(resolve => { release = resolve; });
    const seen = new Map<string, string[]>();
    vi.mocked(callLLMStream).mockImplementation(async function* (options) {
      seen.set(options.userId!, (options.tools ?? []).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []));
      if (seen.size === 2) release();
      await bothModelsStarted;
      yield { type: 'content_delta', data: { delta: 'Isolated reply.' } };
      yield { type: 'done', data: {} };
    });
    await Promise.all(turns.map(turn => chatService.runAssistantGeneration(turn)));
    expect(seen.get(user.id)).toContain('products_list');
    expect(seen.get(user.id)).not.toContain('workspace_list');
    expect(seen.get(other.id)).toContain('workspace_list');
    expect(seen.get(other.id)).not.toContain('products_list');
    for (const names of seen.values()) expect(names).toContain('search_catalog');
    await db.delete(tenantMemberships).where(eq(tenantMemberships.userId, other.id));
    seen.clear();
    const next = await Promise.all([createTurn(other), createTurn(user)]);
    await Promise.all(next.map(turn => chatService.runAssistantGeneration(turn)));
    expect(seen.get(other.id)).toEqual([]);
    expect(seen.get(user.id)).toContain('products_list');
    for (const turn of [...turns, ...next]) {
      const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, turn.assistantMessageId));
      expect(message.content).toBe('Isolated reply.');
    }
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
