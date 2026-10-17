import { describe, expect, it } from 'vitest';
import { commandIdempotencyKey } from '@sentropic/comments';
import { createCanonicalCommentsRouter } from '../src/hono/comments-router.js';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost } from './storage/comments-host.js';
describe.skipIf(!pgEnabled)('canonical comments Hono operational boundary', () => {
  it('creates through services, preserves original registration on retry and refuses forged lifecycle records', async () => {
    const h = await commentsHost();
    try {
      const ports = { store: h.module.store, capabilities: { check: async () => h.authority.allowed }, resolver: { resolve: async () => 'exact' as const }, decisions: { resolve: async () => null } };
      const router = createCanonicalCommentsRouter(ports, { capacity: h.capacity });
      expect((await router.request('/annotations/a')).status).toBe(401);
      const fixture = h.annotation('a'); const { kind: _kind, hash: _hash, link: _link, scope: _scope, provenance, ...fields } = fixture;
      const content = { ...fields, provenance: { attribution: provenance.attribution } };
      const request = { scope: h.scope, content, expected: { kind: 'creation', aggregateVersion: 0 }, idempotencyKey: commandIdempotencyKey('create-a'), decisionRef: '' };
      const post = (path: string, body: unknown) => h.module.withContext(h.grant, () => router.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      const response = await post('/annotations', request); expect(response.status).toBe(200); const stored = await response.json();
      expect(stored.provenance.registration).toEqual({ principal: h.grant.principalId, registeredAt: 1717000000123 });
      expect(await (await post('/annotations', request)).json()).toEqual(stored);
      expect((await post('/annotations/a/revisions', { ...request, idempotencyKey: 'stale' })).status).toBe(409);
      expect((await post('/annotations', { ...request, scope: { ...h.scope, tenantId: 'foreign' } })).status).toBe(403);
      const before = (await h.bound.journalRead(0, 100)).events.length;
      expect((await post('/records', { kind: 'lifecycle-event', action: 'tombstone', objectKind: 'annotation', objectId: 'a' })).status).toBe(404);
      expect((await post('/annotations/a/lifecycle', { scope: h.scope, objectKind: 'annotation', objectId: 'a', action: 'purge-outcome', archiveKind: null, reason: null, decisionRef: '', idempotencyKey: 'forged', expected: { kind: 'creation', aggregateVersion: 0 } })).status).toBe(400);
      h.authority.allowed = false;
      expect((await post('/annotations/a/lifecycle', { scope: h.scope, objectKind: 'annotation', objectId: 'a', action: 'tombstone', archiveKind: null, reason: null, decisionRef: '', idempotencyKey: 'denied-delete', expected: { kind: 'creation', aggregateVersion: 0 } })).status).toBe(403);
      expect((await h.bound.journalRead(0, 100)).events).toHaveLength(before);
      h.authority.allowed = true;
      const read = await h.module.withContext(h.grant, () => router.request('/annotations/a')); expect(await read.json()).toEqual(stored);
      expect((await h.module.withContext(h.grant, () => router.request('/annotations/revisions'))).status).toBe(404);
      expect((await post('/annotations', { ...request, extra: 'unknown' })).status).toBe(400);
      expect((await post('/annotations', { ...request, content: { ...content, body: { ...content.body, text: 'x'.repeat(1048576) } } })).status).toBe(413);
    } finally { await h.fixture.close(); }
  });
});
