import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const CHAT_AUTHOR = 'chat-server-module';

const CHAT_PATHS = [
  '/messages',
  '/messages/:messageId',
  '/messages/:messageId/runtime-details',
  '/messages/:messageId/stop',
  '/messages/:messageId/steer',
  '/messages/:messageId/feedback',
  '/messages/:messageId/retry',
  '/messages/:messageId/tool-results',
  '/sessions',
  '/sessions/:sessionId',
  '/sessions/:sessionId/history',
  '/sessions/:sessionId/messages',
  '/sessions/:sessionId/bootstrap',
  '/sessions/:sessionId/checkpoints',
  '/sessions/:sessionId/checkpoints/:checkpointId/restore',
  '/tool-permissions',
] as const;

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh chat cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureChatAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/chat' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-chat-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: CHAT_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'pre-deletion-shadow-suite',
          safeReadRef: 'historical:f3515b78b:api/tests/api/cluster-mesh-chat-cutover.test.ts',
          validatedIntentRef: 'packages/chat-server/tests/wire-contract.spec.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-chat-router',
        },
      };
      await control.cutovers.activate(shadow);
      await control.cutovers.activate({
        ...shadow,
        status: 'active' as const,
        activatedAt: new Date().toISOString(),
      });
    })().finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === CHAT_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyChatAuthorFence = (router: Hono): void => {
  for (const path of CHAT_PATHS) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureChatAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'chat_control_unavailable' }, 503);
      }
    });
  }
};
