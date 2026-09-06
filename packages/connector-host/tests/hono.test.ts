import { describe, expect, it, vi } from 'vitest';

import {
  createConnectorAdminRouter,
  type ConnectorAdminHandlerInput,
} from '../src/hono.js';

const createFixture = () => {
  const calls: string[] = [];
  const handler = (operation: string) => vi.fn(
    ({ context, principal }: ConnectorAdminHandlerInput) => {
      calls.push(operation);
      return context.json({ operation, userId: principal.userId });
    },
  );
  const handlers = {
    connection: handler('connection'),
    oauthStart: handler('oauth-start'),
    oauthCallback: handler('oauth-callback'),
    disconnect: handler('disconnect'),
    pickerConfig: handler('picker-config'),
    pickerSelection: handler('picker-selection'),
    limitRead: handler('limit-read'),
    limitUpdate: handler('limit-update'),
  };
  const router = createConnectorAdminRouter({
    resolvePrincipal: (context) => context.req.header('x-user')
      ? { userId: context.req.header('x-user')!, workspaceId: 'workspace-1' }
      : undefined,
    providers: [{
      path: '/fake',
      readConnection: handlers.connection,
      startOAuth: handlers.oauthStart,
      completeOAuth: handlers.oauthCallback,
      disconnect: handlers.disconnect,
      picker: {
        readConfig: handlers.pickerConfig,
        resolveSelection: handlers.pickerSelection,
      },
    }],
    accountLimits: {
      path: '/settings/connector-accounts/max-per-provider',
      read: handlers.limitRead,
      update: handlers.limitUpdate,
    },
  });
  return { calls, handlers, router };
};

describe('connector administration Hono router', () => {
  it.each([
    ['GET', '/fake/connection', 'connection'],
    ['POST', '/fake/oauth/start', 'oauth-start'],
    ['GET', '/fake/oauth/callback', 'oauth-callback'],
    ['POST', '/fake/disconnect', 'disconnect'],
    ['GET', '/fake/picker-config', 'picker-config'],
    ['POST', '/fake/files/resolve-picker-selection', 'picker-selection'],
    ['GET', '/settings/connector-accounts/max-per-provider', 'limit-read'],
    ['PUT', '/settings/connector-accounts/max-per-provider', 'limit-update'],
  ] as const)('delegates %s %s through the authenticated product adapter', async (
    method,
    path,
    operation,
  ) => {
    const { calls, router } = createFixture();

    const response = await router.request(path, {
      method,
      headers: { 'x-user': 'user-1' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ operation, userId: 'user-1' });
    expect(calls).toEqual([operation]);
  });

  it('rejects unauthenticated administration before any product adapter runs', async () => {
    const { calls, router } = createFixture();

    for (const [method, path] of [
      ['GET', '/fake/connection'],
      ['POST', '/fake/oauth/start'],
      ['PUT', '/settings/connector-accounts/max-per-provider'],
    ] as const) {
      const response = await router.request(path, { method });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: 'Authentication required' });
    }
    expect(calls).toEqual([]);
  });

  it('rejects duplicate or wildcard adapter paths at construction', () => {
    const provider = {
      path: '/duplicate' as const,
      readConnection: vi.fn(),
      startOAuth: vi.fn(),
      completeOAuth: vi.fn(),
      disconnect: vi.fn(),
    };
    expect(() => createConnectorAdminRouter({
      resolvePrincipal: () => undefined,
      providers: [provider, provider],
    })).toThrow('unique and literal');
    expect(() => createConnectorAdminRouter({
      resolvePrincipal: () => undefined,
      providers: [provider],
      accountLimits: { path: '/settings/*', read: vi.fn(), update: vi.fn() },
    })).toThrow('unique and literal');
  });
});
