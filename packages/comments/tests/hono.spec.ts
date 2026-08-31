import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createCommentsRouter, type CreateCommentsRouterOptions } from '../src/hono.js';
import { InMemoryCommentStore } from '../src/index.js';

const tenant = { tenantId: 'tenant-1', workspaceId: 'workspace-1', userId: 'user-1' };
const principal = { workspaceId: tenant.workspaceId, userId: tenant.userId };

const buildApp = (overrides: Partial<CreateCommentsRouterOptions> = {}) => {
  const store = new InMemoryCommentStore();
  const events: unknown[] = [];
  const options: CreateCommentsRouterOptions = {
    store,
    events: { emit: async (event) => { events.push(event); } },
    tenant: {
      resolve: async () => tenant,
      contextExists: async () => true,
      memberExists: async () => true,
      resolveUsers: async ({ userIds }) => userIds.map((id) => ({
        id,
        email: `${id}@example.com`,
        displayName: id,
      })),
    },
    authz: {
      resolvePrincipal: async () => principal,
      authorize: async () => true,
    },
    ...overrides,
  };
  const app = new Hono().route('/api/v1', createCommentsRouter(options));
  return { app, events, store };
};

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('comments Hono router', () => {
  it('creates and reads comments through injected ports', async () => {
    const { app, events } = buildApp();
    const created = await app.request('/api/v1/comments', jsonRequest('POST', {
      context_type: 'initiative',
      context_id: 'initiative-1',
      section_key: 'summary',
      content: 'Review this',
    }));
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { id: string; thread_id: string };
    expect(Object.keys(createdBody).sort()).toEqual(['id', 'thread_id']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'created',
      key: 'comment_id',
      commentId: createdBody.id,
      origin: 'rest',
    });

    const listed = await app.request(
      '/api/v1/comments?context_type=initiative&context_id=initiative-1',
    );
    expect(listed.status).toBe(200);
    const body = await listed.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: createdBody.id,
      context_type: 'initiative',
      context_id: 'initiative-1',
      section_key: 'summary',
      created_by: 'user-1',
      assigned_to: 'user-1',
      status: 'open',
      content: 'Review this',
    });
  });

  it('validates mutation intent before calling the store', async () => {
    const { app, store } = buildApp();
    const add = vi.spyOn(store, 'add');
    const response = await app.request('/api/v1/comments', jsonRequest('POST', {
      context_type: 'initiative',
      context_id: 'initiative-1',
      content: '',
    }));
    expect(response.status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });
});
