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
import { InMemoryCommentStore, type Comment } from '../src/index.js';

const tenant = { tenantId: 'tenant-1', workspaceId: 'ws-1', userId: 'user-1' };
const basePrincipal: ArtifactCommentsHttpPrincipal = { workspaceId: 'ws-1', userId: 'user-1' };

const buildApp = (overrides: Partial<CreateArtifactCommentsRouterOptions> = {}) => {
  const store = new InMemoryCommentStore();
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
  it('should fail closed on missing/throwing authn and preserve 404/403 authz refusals', async () => {
    const { app, store, setPrincipal } = buildApp();
    const listSpy = vi.spyOn(store, 'listByTarget');
    setPrincipal(undefined);
    expect((await app.request('/api/v1/artifacts/art-1/comments')).status).toBe(401);

    const nf = buildApp({ authz: { resolvePrincipal: async () => basePrincipal, authorizeArtifact: async () => ({ ok: false, status: 404, code: 'artifact_not_found' }) } });
    const nfRes = await nf.app.request('/api/v1/artifacts/art-1/comments');
    expect(nfRes.status).toBe(404);
    expect(await nfRes.json()).toMatchObject({ code: 'artifact_not_found' });

    const fb = buildApp({ authz: { resolvePrincipal: async () => basePrincipal, authorizeArtifact: async () => ({ ok: false, status: 403, code: 'comment_forbidden' }) } });
    const fbRes = await fb.app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Hi' }));
    expect(fbRes.status).toBe(403);
    expect(await fbRes.json()).toMatchObject({ code: 'comment_forbidden' });

    const boom = buildApp({ authz: { resolvePrincipal: async () => basePrincipal, authorizeArtifact: async () => { throw new Error('err'); } } });
    expect((await boom.app.request('/api/v1/artifacts/art-1/comments')).status).toBe(403);
    expect(listSpy).not.toHaveBeenCalled();
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

    vi.spyOn(store, 'listByTarget').mockResolvedValueOnce([nonArt, pgArt, comment]);
    const { items } = await (await app.request('/api/v1/artifacts/art-1/comments')).json() as { items: Comment[] };
    expect(items.map((c) => c.id)).toEqual([pgArt.id, comment.id]);
    expect(items.every((c) => c.target.kind === 'artifact' && c.target.recordType === undefined)).toBe(true);

    const summaries = await (await app.request('/api/v1/artifacts/art-1/comments/summaries?status=open')).json() as { items: Array<{ threadId: string }> };
    expect(summaries.items).toEqual([expect.objectContaining({ threadId: comment.threadId, status: 'open' })]);
  });

  it('should inherit section_key from first surviving row on reply and scope thread listing by artifact', async () => {
    const { app, setPrincipal } = buildApp();
    const { comment: root } = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Root', section_key: 'a1:keep' }))).json() as { comment: Comment };

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
    const { app, setPrincipal } = buildApp();
    const { comment: root } = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Discuss' }))).json() as { comment: Comment };

    setPrincipal({ workspaceId: 'ws-1', userId: 'user-2' });
    expect((await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.id}/close`, req('POST'))).status).toBe(404);
    expect((await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/close`, req('POST'))).status).toBe(200);
    expect((await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/reopen`, req('POST'))).status).toBe(200);

    const assign = await app.request(`/api/v1/artifacts/art-1/comments/threads/${root.threadId}/assignee`, req('PATCH', { assigned_to: 'user-2' }));
    expect((await assign.json() as { items: Comment[] }).items[0]?.assignedTo).toBe('user-2');
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

    setPrincipal(basePrincipal);
    expect((await app.request(`/api/v1/artifacts/art-2/comments/${root.id}`, req('PATCH', { content: 'Wrong' }))).status).toBe(404);
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
    const { comment: root } = await (await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Cap', section_key: atCap }))).json() as { comment: Comment };
    expect((await app.request(`/api/v1/artifacts/art-1/comments?section_key=${atCap}`)).status).toBe(200);

    const [addSpy, listSpy, sumSpy] = [vi.spyOn(store, 'add'), vi.spyOn(store, 'listByTarget'), vi.spyOn(store, 'listThreadSummaries')];
    for (const res of [
      await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Over', section_key: overCap })),
      await app.request('/api/v1/artifacts/art-1/comments', req('POST', { content: 'Over', thread_id: root.threadId, section_key: overCap })),
      await app.request(`/api/v1/artifacts/art-1/comments?section_key=${overCap}`),
      await app.request(`/api/v1/artifacts/art-1/comments/summaries?section_key=${overCap}`),
    ]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: SECTION_KEY_TOO_LONG_CODE, maxLength: 2048 });
    }
    expect(addSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
    expect(sumSpy).not.toHaveBeenCalled();
  });
});
