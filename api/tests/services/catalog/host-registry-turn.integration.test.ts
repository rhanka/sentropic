import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { chatSessions, tenantMemberships } from '../../../src/db/schema';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../../utils/auth-helper';

vi.mock('../../../src/services/llm-runtime', () => ({ callLLMStream: vi.fn() }));
import { callLLMStream } from '../../../src/services/llm-runtime';
import { productArtifactTransport } from '../../../src/services/artifacts/instance';
import { chatService } from '../../../src/services/chat-service';
import { CHAT_COMMON_PROMPTS } from '../../../src/config/default-chat-system';

describe('compiled host registry in real chat model discovery', () => {
  let user: TestUser;
  let evaluationTemplate: string;
  beforeEach(async () => {
    evaluationTemplate = CHAT_COMMON_PROMPTS.reasoning_effort_eval;
    CHAT_COMMON_PROMPTS.reasoning_effort_eval = '';
    vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '1');
    user = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({ userId: user.id, tenantId: 'sentropic', status: 'approved' });
  });
  afterEach(async () => {
    CHAT_COMMON_PROMPTS.reasoning_effort_eval = evaluationTemplate;
    vi.unstubAllEnvs();
    vi.mocked(callLLMStream).mockReset();
    await cleanupAuthData();
  });

  it('should offer exact permitted compiled tools to real generation and omit them after revocation', async () => {
    const names = [...(await productArtifactTransport.ready).tools.keys()];
    const other = await createAuthenticatedUser('guest');
    await db.insert(tenantMemberships).values({ userId: other.id, tenantId: 'sentropic', status: 'approved' });
    const seen = new Map<string, string[]>();
    vi.mocked(callLLMStream).mockImplementation(async function* (options) {
      seen.set(options.userId!, (options.tools ?? []).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []));
      yield { type: 'content_delta', data: { delta: 'Catalog-qualified reply.' } };
      yield { type: 'done', data: {} };
    });
    const run = async (actor: TestUser) => {
      const turn = await chatService.createUserMessageWithAssistantPlaceholder({ userId: actor.id,
        workspaceId: actor.workspaceId!, content: 'Show artifact tools', model: 'gpt-4.1-nano' });
      await db.update(chatSessions).set({ title: 'Host catalog test' }).where(eq(chatSessions.id, turn.sessionId));
      await chatService.runAssistantGeneration({ userId: actor.id, ...turn });
    };
    await Promise.all([run(user), run(other)]);
    expect(seen.get(user.id)).toEqual(expect.arrayContaining(names));
    expect(seen.get(other.id)?.filter(name => names.includes(name))).toEqual(['artifacts_get', 'artifacts_list']);
    await db.delete(tenantMemberships).where(eq(tenantMemberships.userId, other.id));
    await run(other);
    expect(seen.get(other.id)).toEqual([]);
    vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '0');
    await run(user);
    expect(seen.get(user.id)?.filter(name => names.includes(name))).toEqual([]);
  });
});
