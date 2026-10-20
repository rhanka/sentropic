import { describe, expect, it } from 'vitest';
import { createAnnotationRevision, commandIdempotencyKey } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('operational comments lifecycle', () => {
  it('checks every resource twice and commits tombstone/barrier/index together without inventing purge authority', async () => {
    const scope = conformanceScope(); let allowed = true; let calls = 0;
    const services = { capacity: conformanceCapacity(), capabilities: { check: async (_principal, capability, targets) => { calls++; expect(targets).toHaveLength(2); return allowed && capability !== 'purge'; } }, resolver: { resolve: async () => 'exact' as const }, clock: { now: () => 1234 } };
    const fixture = await createPgFixture(await createCommentsPostgresRegistration({ services }));
    try {
      const root = await fixture.open(); const grant = grantFor({ scope }); await root.bindNew(grant);
      const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      const annotation = createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [conformanceTarget(conformanceResource(scope, 'secondary'))], visualAnchors: [], body: conformanceBody('sensitive'), provenance: conformanceProvenance() }, conformanceCapacity());
      await module.withContext(grant, async () => {
        await module.store.appendAnnotationRevision(scope, 'a', annotation, { kind: 'creation', aggregateVersion: 0 });
        const request = { scope, objectKind: 'annotation' as const, objectId: 'a', action: 'tombstone' as const, archiveKind: null, reason: null, decisionRef: '', idempotencyKey: commandIdempotencyKey('delete'), expected: { kind: 'creation' as const, aggregateVersion: 0 } };
        allowed = false; await expect(module.services.lifecycle(request)).rejects.toMatchObject({ code: 'denied' });
        expect((await module.store.getAnnotationHead(scope, 'a'))?.hash).toBe(annotation.hash);
        allowed = true; calls = 0; const result = await module.services.lifecycle(request);
        expect(calls).toBeGreaterThanOrEqual(2); expect(result.intentId).toBeNull();
        await expect(module.store.getAnnotationHead(scope, 'a')).rejects.toMatchObject({ code: 'denied' });
        expect(await module.services.lifecycle(request)).toEqual(result);
      });
      const maintenance = await root.bindNew(grantFor({ scope, token: 'maintenance', operations: ['read', 'write', 'maintain'] }));
      expect((await maintenance.purgeRead('jobs', { limit: 100 })).records).toHaveLength(0);
    } finally { await fixture.close(); }
  });
  it('creates one canonical completion only after actual erasure, under the verified maintenance principal', async () => {
    const scope = conformanceScope();
    const services = { capacity: conformanceCapacity(), capabilities: { check: async () => true }, resolver: { resolve: async () => 'exact' as const }, clock: { now: () => 1234 } };
    const fixture = await createPgFixture(await createCommentsPostgresRegistration({ services }));
    try {
      const root = await fixture.open(); const grant = grantFor({ scope, operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      await bound.configureLifecycle('required');
      const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      await module.withContext(grant, async () => {
        const annotation = createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('erase-this-secret'), provenance: conformanceProvenance() }, conformanceCapacity());
        await module.store.appendAnnotationRevision(scope, 'a', annotation, { kind: 'creation', aggregateVersion: 0 });
        const request = { scope, objectKind: 'annotation' as const, objectId: 'a', action: 'tombstone' as const, archiveKind: null, reason: null, decisionRef: '', idempotencyKey: commandIdempotencyKey('delete'), expected: { kind: 'creation' as const, aggregateVersion: 0 } };
        const result = await module.services.lifecycle(request); expect(result.intentId).toBeTypeOf('string');
        const job = await module.services.completePurge(result.intentId!); expect(job.state).toBe('complete');
        expect(await module.services.completePurge(result.intentId!)).toEqual(job);
        await expect(module.store.getLifecycleChain(scope, 'annotation', 'a')).rejects.toMatchObject({ code: 'denied' });
      });
      await fixture.tx.run(true, async (session) => {
        const rows = (await session.execute({ text: `SELECT convert_from(bytes,'UTF8') AS bytes FROM "${fixture.name}".payloads WHERE bytes IS NOT NULL`, values: [] })).rows;
        expect(rows.some((row) => String(row.bytes).includes('erase-this-secret'))).toBe(false);
        const completions = rows.map((row) => { const value = JSON.parse(String(row.bytes)); return value.format === 'utf8' ? JSON.parse(value.data) : value; }).filter((value) => value.kind === 'lifecycle-event' && value.action === 'purge-outcome');
        expect(completions.length).toBeGreaterThanOrEqual(1); expect(completions.every((record) => record.actor.principal === grant.principalId && record.reason === null)).toBe(true);
      });
    } finally { await fixture.close(); }
  });
});
