import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import {
  createChatServer,
  type ChatServerDeps,
  type ChatServerOptions,
} from '../../../../packages/chat-server/src/index';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { createProductChatServerDeps } from '../../services/chat-server-provider';
import { requireWorkspaceAccess, requireWorkspaceEditor } from '../../services/workspace-access';
import { applyChatAuthorFence } from './chat-cutover';

export const DEFAULT_ALL_WS_LIMIT = 200;

export interface CreateChatNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly deps?: ChatServerDeps;
  readonly authorize?: ChatServerOptions['authorize'];
}

const authorizeProductChat: NonNullable<ChatServerOptions['authorize']> = async ({
  user,
  action,
}) => {
  if (!user.workspaceId) return false;
  if (action === 'editMessage' || action === 'restoreCheckpoint') {
    await requireWorkspaceEditor(user.userId, user.workspaceId);
    return true;
  }
  await requireWorkspaceAccess(user.userId, user.workspaceId);
  return true;
};

export const createChatNamespaceModule = (
  options: CreateChatNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/chat',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    router.use('*', options.authenticate ?? requireAuth);
    applyChatAuthorFence(router);
    router.route('/', createChatServer(
      options.deps ?? createProductChatServerDeps(),
      {
        routes: 'app-contract',
        basePath: '',
        includeControls: true,
        allWorkspaceSessionLimit: DEFAULT_ALL_WS_LIMIT,
        authorize: options.authorize ?? authorizeProductChat,
      },
    ));
    return router;
  },
});

export const productChatModule = createChatNamespaceModule();
