import { readFileSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  createResourcesTransportRouter,
  RESOURCE_PATHS,
  RESOURCE_ROUTES,
  type ResourceProjectionPort,
  type ResourcesNamespacePorts,
} from '../../src/routes/namespaces/resources-module';

const pass: MiddlewareHandler = async (_context, next) => next();
const principal = {
  userId: 'user-a',
  scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
  context: {
    userId: 'user-a',
    role: 'editor',
    workspaceType: 'ai-priorities',
    roles: ['editor'],
    permissions: [],
    permissionMode: 'allowlist' as const,
    allowedTools: [],
  },
};
const request = (app: Hono, path: string, body: unknown) => app.request(`/api/v1${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const createProjection = (): ResourceProjectionPort => ({
  dispatch: vi.fn(async ({ verb, target, args, principal: resolved }) => ({
    verb,
    target,
    args,
    scope: resolved.scope,
    ...(verb === 'read'
      ? { provenance: { provider: 'fixture', trust: 'external', origin: 'test' } }
      : {}),
  })),
});
const createPorts = (resources = createProjection()): ResourcesNamespacePorts => ({
  resources,
  principal: { resolve: vi.fn(async () => principal) },
  authenticate: pass,
});

describe('cluster mesh resources transport', () => {
  it('requires injected ports and exposes only six exact POST routes', async () => {
    expect(() => createResourcesTransportRouter({
      ...createPorts(), resources: undefined,
    } as unknown as ResourcesNamespacePorts)).toThrowError('resources product ports are unavailable');
    const router = createResourcesTransportRouter(createPorts());
    expect(router.routes.map(({ method, path }) => [method, path])).toEqual(RESOURCE_ROUTES);
    expect(RESOURCE_PATHS).toHaveLength(6);
    expect(RESOURCE_PATHS).not.toContain('/*');

    const source = readFileSync(
      new URL('../../src/routes/namespaces/resources.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
    const app = new Hono().route('/api/v1', router);
    expect((await app.request('/api/v1/resources/list')).status).toBe(404);
    expect((await app.request('/api/v1/resources/unknown', { method: 'POST' })).status).toBe(404);
  });

  it('projects every validated verb with server-resolved principal and provenance intact', async () => {
    const resources = createProjection();
    const app = new Hono().route('/api/v1', createResourcesTransportRouter(createPorts(resources)));
    const cases = [
      ['/resources/list', { path: '/', limit: 4 }],
      ['/resources/stat', { path: '/skills/planner' }],
      ['/resources/read', { ref: { provider: 'catalog', type: 'skill', id: 'skill:foundation:planner' }, maxBytes: 80 }],
      ['/resources/grep', { path: '/skills', query: 'planner', limit: 2 }],
      ['/resources/edit', { path: '/canvas/draft', etag: 'v1', content: 'updated', contentType: 'text/plain' }],
      ['/resources/invoke', { path: '/tools/planner', args: { topic: 'mesh' }, idempotencyKey: 'invoke-1' }],
    ] as const;

    for (const [path, body] of cases) {
      const response = await request(app, path, body);
      expect(response.status, path).toBe(200);
      const result = (await response.json()).result;
      expect(result.scope).toEqual(principal.scope);
      if (path === '/resources/read') {
        expect(result.provenance).toEqual({ provider: 'fixture', trust: 'external', origin: 'test' });
      }
    }
    expect(resources.dispatch).toHaveBeenCalledTimes(6);
    expect(resources.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      verb: 'invoke',
      target: { path: '/tools/planner' },
      args: { args: { topic: 'mesh' }, idempotencyKey: 'invoke-1' },
      principal,
    }));
  });

  it('rejects caller scope and malformed effect intent before dispatch', async () => {
    const resources = createProjection();
    const app = new Hono().route('/api/v1', createResourcesTransportRouter(createPorts(resources)));
    const scoped = await request(app, '/resources/read', {
      ref: {
        provider: 'catalog', type: 'skill', id: 'skill:foundation:planner',
        scope: { tenantId: 'tenant-b', workspaceId: 'workspace-b' },
      },
    });
    const invalidInvoke = await request(app, '/resources/invoke', {
      path: '/tools/planner', args: 'not-an-object',
    });
    expect(scoped.status).toBe(400);
    expect(invalidInvoke.status).toBe(400);
    expect(resources.dispatch).not.toHaveBeenCalled();
  });
});
