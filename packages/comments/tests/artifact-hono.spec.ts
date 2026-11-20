import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH,
  PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE,
  SECTION_KEY_TOO_LONG_CODE,
  createArtifactCommentsRouter,
  type ArtifactCommentsHttpPrincipal,
  type CreateArtifactCommentsRouterOptions,
} from '../src/artifact-hono.js';
import { InMemoryCommentStore, type Comment, type CommentThreadSummary } from '../src/index.js';

const tenant = { tenantId: 'tenant-1', workspaceId: 'ws-1', userId: 'user-1' };
const basePrincipal: ArtifactCommentsHttpPrincipal = { workspaceId: 'ws-1', userId: 'user-1' };

const buildApp = (overrides: Partial<CreateArtifactCommentsRouterOptions> = {}) => {
  const store = overrides.store ?? new InMemoryCommentStore();
  const events: unknown[] = [];
  let active: ArtifactCommentsHttpPrincipal | undefined = basePrincipal;
  const app = new Hono().route('/api/v1', createArtifactCommentsRouter({
    store,
    events: { emit: async (event) => { events.push(event); } },
    tenant: {
      resolve: async (p) => ({ ...tenant, workspaceId: p.workspaceId, userId: p.userId }),
      memberExists: async ({ userId }) => userId !== 'outsider',
    },
    authz: {
      resolvePrincipal: async () => active,
      authorizeArtifact: async () => ({ ok: true }),
      isAdmin: async (p) => p.userId === 'admin-1',
    },
    nonHumanClientIds: ['h2a-cli'],
    ...overrides,
  }));
  return { app, store, events, setPrincipal: (p: ArtifactCommentsHttpPrincipal | undefined) => { active = p; } };
};

const req = (method: string, body?: unknown, headers?: Record<string, string>): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('artifact-comments Hono router (C2b + S4-route)', () => {
  it('should guard all 9 routes before tenant/store access with read vs comment actions and fail closed', async () => {
    const routes: Array<{ method: string; path: string; body?: unknown; expectedAction: 'read' | 'comment' }> = [
      { method: 'GET', path: '/api/v1/artifacts/art-1/comments', expectedAction: 'read' },
      { method: 'GET', path: '/api/v1/artifacts/art-1/comments/summaries', expectedAction: 'read' },
      { method: 'GET', path: '/api/v1/artifacts/art-1/comments/threads/th-1', expectedAction: 'read' },
      { method: 'POST', path: '/api/v1/artifacts/art-1/comments', body: { content: 'Hi' }, expectedAction: 'comment' },
      { method: 'POST', path: '/api/v1/artifacts/art-1/comments/threads/th-1/close', expectedAction: 'comment' },
      { method: 'POST', path: '/api/v1/artifacts/art-1/comments/threads/th-1/reopen', expectedAction: 'comment' },
      { method: 'PATCH', path: '/api/v1/artifacts/art-1/comments/threads/th-1/assignee', body: { assigned_to: null }, expectedAction: 'comment' },
      { method: 'PATCH', path: '/api/v1/artifacts/art-1/comments/c-1', body: { content: 'Ed' }, expectedAction: 'comment' },
      { method: 'DELETE', path: '/api/v1/artifacts/art-1/comments/c-1', expectedAction: 'comment' },
    ];
    for (const r of routes) {
      const tenantResolve = vi.fn(async () => tenant);
      const memberExists = vi.fn(async () => true);
      const store = new InMemoryCommentStore();
      const storeSpies = [
        vi.spyOn(store, 'listByTarget'), vi.spyOn(store, 'listThreadSummaries'), vi.spyOn(store, 'listThread'),
        vi.spyOn(store, 'add'), vi.spyOn(store, 'setState'), vi.spyOn(store, 'assign'),
        vi.spyOn(store, 'get'), vi.spyOn(store, 'edit'), vi.spyOn(store, 'delete'),
      ];
      for (const authz of [
        { resolvePrincipal: async () => undefined, authorizeArtifact: async () => ({ ok: true as const }) },
        { resolvePrincipal: async () => { throw new Error('authn boom'); }, authorizeArtifact: async () => ({ ok: true as const }) },
      ]) {
        const { app } = buildApp({ store, tenant: { resolve: tenantResolve, memberExists }, authz });
        expect((await app.request(r.path, req(r.method, r.body))).status).toBe(401);
      }

      const nf = buildApp({
        store,
        tenant: { resolve: tenantResolve, memberExists },
        authz: { resolvePrincipal: async () => basePrincipal, authorizeArtifact: async () => ({ ok: false, status: 404, code: 'artifact_not_found' }) },
      });
      const nfRes = await nf.app.request(r.path, req(r.method, r.body));
      expect(nfRes.status).toBe(404);
      expect(await nfRes.json()).toMatchObject({ code: 'artifact_not_found' });

      const boom = buildApp({
        store,
        tenant: { resolve: tenantResolve, memberExists },
        authz: { resolvePrincipal: async () => basePrincipal, authorizeArtifact: async () => { throw new Error('authz boom'); } },
      });
      const boomRes = await boom.app.request(r.path, req(r.method, r.body));
      expect(boomRes.status).toBe(403);
      expect(await boomRes.json()).toMatchObject({ code: 'comment_forbidden' });
      expect(tenantResolve).not.toHaveBeenCalled();
      expect(memberExists).not.toHaveBeenCalled();
      for (const spy of storeSpies) expect(spy).not.toHaveBeenCalled();

      const seenActions: Array<'read' | 'comment'> = [];
      const viewer = buildApp({
        store,
        tenant: { resolve: tenantResolve, memberExists },
        authz: {
          resolvePrincipal: async () => basePrincipal,
          authorizeArtifact: async ({ artifactId, action }) => {
            expect(artifactId).toBe('art-1');
            seenActions.push(action);
            return action === 'read' ? { ok: true } : { ok: false, status: 403, code: 'comment_forbidden' };
          },
        },
      });
      const viewerRes = await viewer.app.request(r.path, req(r.method, r.body));
      expect(seenActions).toEqual([r.expectedAction]);
      if (r.expectedAction === 'comment') {
        expect(viewerRes.status).toBe(403);
        expect(await viewerRes.json()).toMatchObject({ code: 'comment_forbidden' });
        expect(tenantResolve).not.toHaveBeenCalled();
        expect(memberExists).not.toHaveBeenCalled();
        for (const spy of storeSpies) expect(spy).not.toHaveBeenCalled();
      } else {
        expect([200, 404]).toContain(viewerRes.status);
      }
    }
  });

  it('should create unassigned root threads, filter artifact context only, and expose summaries', async () => {
    const { app, store, events } = buildApp();
    const nonArt = await store.add(tenant, { tenant, target: { kind: 'record', id: 'art-1', recordType: 'initiative' }, author: { id: 'user-1' }, body: 'Init' });
    const pgArt = await store.add(tenant, { tenant, target: { kind: 'record', id: 'art-1', recordType: 'artifact', sectionKey: 'a1:pg' }, author: { id: 'user-1' }, body: 'PG' });

    const created = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Anchor', section_key: 'a1:root' }));
    expect(created.status).toBe(201);
    const { comment } = await created.json() as { comment: Comment };
    expect(comment).toMatchObject({ target: { kind: 'artifact', id: 'art-1', sectionKey: 'a1:root' }, state: 'open', body: 'Anchor' });
    expect(comment.assignedTo).toBeUndefined();
    expect(events[0]).toMatchObject({ action: 'created', contextType: 'artifact', contextId: 'art-1', threadId: comment.threadId });

    const blankRes = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: '   ' }));
    expect(blankRes.status).toBe(400);
    expect(await blankRes.json()).toMatchObject({ code: 'invalid_request' });
    const outsiderRes = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'X', assigned_to: 'outsider' }));
    expect(outsiderRes.status).toBe(400);
    expect(await outsiderRes.json()).toMatchObject({ code: 'assignee_not_in_workspace' });

    vi.spyOn(store, 'listByTarget').mockResolvedValueOnce([nonArt, pgArt, comment]);
    const { items } = await (await app.request('/api/v1/artifacts/art-1/comments')).json() as { items: Comment[] };
    expect(items.map((c) => c.id)).toEqual([pgArt.id, comment.id]);
    expect(items.every((c) => c.target.kind === 'artifact' && c.target.recordType === undefined)).toBe(true);

    const now = new Date().toISOString();
    const pgInitSummary: CommentThreadSummary = {
      threadId: nonArt.threadId, contextType: 'initiative', target: nonArt.target,
      rootMessage: 'Init', rootMessageAt: now, lastMessage: 'Init', lastMessageAt: now, messageCount: 1, status: 'open',
    };
    const pgArtSummary: CommentThreadSummary = {
      threadId: pgArt.threadId, contextType: 'record', target: pgArt.target, sectionKey: 'a1:pg',
      rootMessage: 'PG', rootMessageAt: now, lastMessage: 'PG', lastMessageAt: now, messageCount: 1, status: 'open',
    };
    vi.spyOn(store, 'listThreadSummaries').mockResolvedValueOnce([pgInitSummary, pgArtSummary]);
    const filteredSummaries = await (await app.request('/api/v1/artifacts/art-1/comments/summaries?status=open')).json() as { items: CommentThreadSummary[] };
    expect(filteredSummaries.items).toEqual([expect.objectContaining({
      threadId: pgArt.threadId,
      contextType: 'artifact',
      target: { kind: 'artifact', id: 'art-1', sectionKey: 'a1:pg' },
    })]);
    expect(filteredSummaries.items[0]?.target.recordType).toBeUndefined();

    const summaries = await (await app.request('/api/v1/artifacts/art-1/comments/summaries?status=open')).json() as { items: Array<{ threadId: string }> };
    expect(summaries.items).toEqual([expect.objectContaining({ threadId: comment.threadId, status: 'open' })]);

    for (const path of ['/api/v1/artifacts/art-1/comments?status=resolved', '/api/v1/artifacts/art-1/comments/summaries?status=resolved']) {
      const badQuery = await app.request(path);
      expect(badQuery.status).toBe(400);
      expect(await badQuery.json()).toMatchObject({ code: 'invalid_query' });
    }
  });

  it('should inherit section_key from first surviving row on reply and scope thread listing by artifact', async () => {
    const { app, setPrincipal } = buildApp();
    const { comment: root } = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Root', section_key: 'a1:keep' }))).json() as { comment: Comment };

    const crossReply = await app.request('/api/v1/artifacts/art-2/comments', req('POST', { content: 'Cross', thread_id: root.threadId }));
    expect(crossReply.status).toBe(404);
    expect(await crossReply.json()).toMatchObject({ code: 'thread_not_found' });
    const missingReply = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Missing', thread_id: 'th-missing' }));
    expect(missingReply.status).toBe(404);
    expect(await missingReply.json()).toMatchObject({ code: 'thread_not_found' });

    setPrincipal({ workspaceId: 'ws-1', userId: 'user-2' });
    const r1 = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'R1', thread_id: root.threadId }))).json() as { comment: Comment };
    expect(r1.comment.target.sectionKey).toBe('a1:keep');

    setPrincipal(basePrincipal);
    expect((await app.request(`/api/v1/artifacts/art-1/comments/${root.id}`, req('DELETE'))).status).toBe(200);

    setPrincipal({ workspaceId: 'ws-1', userId: 'user-3' });
    const r2 = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'R2', thread_id: root.threadId }))).json() as { comment: Comment };
    expect(r2.comment.target.sectionKey).toBe('a1:keep');

    const thread = await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}`);
    expect(thread.status).toBe(200);
    expect((await thread.json() as { items: Comment[] }).items).toHaveLength(2);
    expect((await app.request(`/api/v1/artifacts/art-2/comments/threads/${root.threadId}`)).status).toBe(404);
  });

  it('should key close/reopen/assign by threadId for any comment participant and preserve null unassign', async () => {
    const { app, events, setPrincipal } = buildApp();
    const { comment: root } = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Discuss' }))).json() as { comment: Comment };

    setPrincipal({ workspaceId: 'ws-1', userId: 'user-2' });
    expect((await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.id}/close`, req('POST'))).status).toBe(404);
    expect((await app.request(`/api/v1/artifacts/art-2/comments/threads/${root.threadId}/close`, req('POST'))).status).toBe(404);
    const closed = await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/close`, req('POST'));
    expect(closed.status).toBe(200);
    expect((await closed.json() as { items: Comment[] }).items.map((c) => c.state)).toEqual(['closed']);
    expect(events.at(-1)).toMatchObject({ action: 'closed', key: 'thread_id', threadId: root.threadId });

    const reopened = await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/reopen`, req('POST'));
    expect(reopened.status).toBe(200);
    expect((await reopened.json() as { items: Comment[] }).items.map((c) => c.state)).toEqual(['open']);
    expect(events.at(-1)).toMatchObject({ action: 'reopened', key: 'thread_id', threadId: root.threadId });

    for (const [path, method, body] of [
      [`/api/v1/artifacts/art-1/comments/threads/${root.id}/reopen`, 'POST', undefined],
      [`/api/v1/artifacts/art-1/comments/threads/${root.id}/assignee`, 'PATCH', { assigned_to: null }],
      [`/api/v1/artifacts/art-2/comments/threads/${root.threadId}/assignee`, 'PATCH', { assigned_to: null }],
    ] as const) {
      const nfRes = await app.request(path, req(method, body));
      expect(nfRes.status).toBe(404);
      expect(await nfRes.json()).toMatchObject({ code: 'thread_not_found' });
    }
    const badAssign = await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/assignee`, req('PATCH', {}));
    expect(badAssign.status).toBe(400);
    expect(await badAssign.json()).toMatchObject({ code: 'invalid_request' });

    const assign = await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/assignee`, req('PATCH', { assigned_to: 'user-2' }));
    expect((await assign.json() as { items: Comment[] }).items[0]?.assignedTo).toBe('user-2');
    expect(events.at(-1)).toMatchObject({ action: 'reassigned', key: 'thread_id', threadId: root.threadId });
    const unassign = await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/assignee`, req('PATCH', { assigned_to: null }));
    expect((await unassign.json() as { items: Comment[] }).items[0]?.assignedTo).toBeUndefined();
    expect((await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/assignee`, req('PATCH', { assigned_to: 'outsider' }))).status).toBe(400);
  });

  it('should restrict edit and delete to author or admin and reject cross-artifact ids', async () => {
    const { app, setPrincipal } = buildApp();
    const { comment: root } = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Mine' }))).json() as { comment: Comment };

    setPrincipal({ workspaceId: 'ws-1', userId: 'user-2' });
    expect((await app.request(`/api/v1/artifacts/art-1/comments/${root.id}`, req('PATCH', { content: 'No' }))).status).toBe(403);
    expect((await app.request(`/api/v1/artifacts/art-1/comments/${root.id}`, req('DELETE'))).status).toBe(403);
    for (const crossRes of [
      await app.request(`/api/v1/artifacts/art-2/comments/${root.id}`, req('PATCH', { content: 'Probe' })),
      await app.request(`/api/v1/artifacts/art-2/comments/${root.id}`, req('DELETE')),
    ]) {
      expect(crossRes.status).toBe(404);
      expect(await crossRes.json()).toMatchObject({ code: 'comment_not_found' });
    }

    setPrincipal(basePrincipal);
    expect((await app.request(`/api/v1/artifacts/art-2/comments/${root.id}`, req('PATCH', { content: 'Wrong' }))).status).toBe(404);
    expect((await app.request(`/api/v1/artifacts/art-2/comments/${root.id}`, req('DELETE'))).status).toBe(404);
    const blankEdit = await app.request(`/api/v1/artifacts/art-1/comments/${root.id}`, req('PATCH', { content: '   ' }));
    expect(blankEdit.status).toBe(400);
    expect(await blankEdit.json()).toMatchObject({ code: 'invalid_request' });
    const edited = await app.request(`/api/v1/artifacts/art-1/comments/${root.id}`, req('PATCH', { content: 'Edited' }));
    expect((await edited.json() as { comment: Comment }).comment.body).toBe('Edited');

    setPrincipal({ workspaceId: 'ws-1', userId: 'admin-1' });
    expect((await app.request(`/api/v1/artifacts/art-1/comments/${root.id}`, req('DELETE'))).status).toBe(200);
  });

  it('should enforce HTTP provenance.toolCallId rule on create and reply', async () => {
    const { app, store, setPrincipal } = buildApp();
    const addSpy = vi.spyOn(store, 'add');
    for (const provenance of [{}, { runId: 'r1' }, { toolCallId: '' }, { toolCallId: '   ' }]) {
      const res = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Bad', provenance }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE });
    }
    expect((await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'A', actor_kind: 'agent' }))).status).toBe(400);
    expect((await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'N' }, { 'x-sentropic-actor-kind': 'nhi' }))).status).toBe(400);
    for (const badHeader of ['', '   ', 'bot']) {
      const badRes = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'H' }, { 'x-sentropic-actor-kind': badHeader }));
      expect(badRes.status).toBe(400);
      expect(await badRes.json()).toMatchObject({ code: 'invalid_request' });
    }
    setPrincipal({ workspaceId: 'ws-1', userId: 'user-1', clientId: 'h2a-cli' });
    expect((await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Spoof', actor_kind: 'human' }))).status).toBe(400);
    expect(addSpy).not.toHaveBeenCalled();

    const ok = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Agent', provenance: { toolCallId: ' agent:s1:1 ', runId: 'run-1' } }));
    expect(ok.status).toBe(201);
    const { comment: root } = await ok.json() as { comment: Comment };
    expect(root.provenance).toEqual({ toolCallId: 'agent:s1:1', runId: 'run-1' });
    expect((await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'No prov', thread_id: root.threadId }))).status).toBe(400);
    expect((await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Ok', thread_id: root.threadId, provenance: { toolCallId: 'agent:s1:2' } }))).status).toBe(201);
  });

  it('should enforce the 2048-character section_key cap with stable 400 code on list, summaries, create, and reply', async () => {
    const { app, store } = buildApp();
    const atCap = 'a'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH);
    const overCap = 'a'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH + 1);
    const hugeOverCap = 'a'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH * 2 + 1);
    const emojiAtCap = '😀'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH);
    const emojiOverCap = '😀'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH + 1);
    const encodedAtCap = encodeURIComponent(`a1:${'x'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH - 3)}`);
    const encodedOverCap = encodeURIComponent(`a1:${'x'.repeat(ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH - 2)}`);

    const fromSpy = vi.spyOn(Array, 'from');
    try {
      const capRes = await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Cap', section_key: atCap }));
      expect(capRes.status).toBe(201);
      const { comment: root } = await capRes.json() as { comment: Comment };
      expect((await app.request(`/api/v1/artifacts/art-1/comments?section_key=${atCap}`)).status).toBe(200);
      expect((await app.request(`/api/v1/artifacts/art-1/comments?section_key=${encodedAtCap}`)).status).toBe(200);
      expect((await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Emoji', section_key: emojiAtCap }))).status).toBe(201);

      const [addSpy, listSpy, sumSpy] = [vi.spyOn(store, 'add'), vi.spyOn(store, 'listByTarget'), vi.spyOn(store, 'listThreadSummaries')];
      for (const res of [
        await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Over', section_key: overCap })),
        await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Huge', section_key: hugeOverCap })),
        await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'EmojiOver', section_key: emojiOverCap })),
        await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Over', thread_id: root.threadId, section_key: overCap })),
        await app.request(`/api/v1/artifacts/art-1/comments?section_key=${overCap}`),
        await app.request(`/api/v1/artifacts/art-1/comments?section_key=${encodedOverCap}`),
        await app.request(`/api/v1/artifacts/art-1/comments/summaries?section_key=${overCap}`),
      ]) {
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: SECTION_KEY_TOO_LONG_CODE, maxLength: 2048 });
      }
      expect(fromSpy.mock.calls.some(([arg]) => arg === atCap || arg === hugeOverCap || arg === emojiOverCap)).toBe(false);
      expect(addSpy).not.toHaveBeenCalled();
      expect(listSpy).not.toHaveBeenCalled();
      expect(sumSpy).not.toHaveBeenCalled();
    } finally {
      fromSpy.mockRestore();
    }
  });
});
