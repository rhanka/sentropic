import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAnnotationRevision, hashRecord } from '@sentropic/comments';
import type { CanonicalCommandStore, CanonicalStoreScope } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { runCommentsConformance, conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
const annotation = (scope: CanonicalStoreScope, id: string, text = 'content') => createAnnotationRevision(null, {
  scope, annotationId: id, primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody(text), provenance: conformanceProvenance(),
}, conformanceCapacity());
describe.skipIf(!pgEnabled)('comments frozen store on the shared Postgres root', () => {
  it('runs the unchanged digest-pinned M1 corpus through explicit issued host contexts', async () => {
    const fixture = await createPgFixture(await createCommentsPostgresRegistration());
    try {
      const root = await fixture.open(); const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      const grants = new Map();
      const oracleHost = new Proxy({} as CanonicalCommandStore, { get(_target, key) { return async (scope: CanonicalStoreScope, ...args: unknown[]) => {
        const identity = JSON.stringify(scope); let grant = grants.get(identity);
        if (!grant) { grant = grantFor({ scope, token: identity }); await root.bindNew(grant); grants.set(identity, grant); }
        return module.withContext(grant, () => Reflect.apply(module.store[key as keyof CanonicalCommandStore] as (...values: unknown[]) => unknown, module.store, [scope, ...args]));
      }; } });
      const manifest = JSON.parse(await readFile(new URL('../assets/storage/comments/oracle/manifest.json', import.meta.url), 'utf8'));
      for (const artifact of manifest.artifacts) expect(createHash('sha256').update(await readFile(new URL(`../assets/storage/comments/oracle/${artifact.file}`, import.meta.url))).digest('hex')).toBe(artifact.sha256);
      await runCommentsConformance(oracleHost);
    } finally { await fixture.close(); }
  });
  it('requires live matching contexts and keeps simultaneous requests isolated', async () => {
    const fixture = await createPgFixture(await createCommentsPostgresRegistration());
    try {
      const root = await fixture.open(); const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      const scope = conformanceScope(); const grant = grantFor({ scope }); await root.bindNew(grant);
      await expect(module.store.getAnnotationHead(scope, 'a')).rejects.toMatchObject({ code: 'denied' });
      const record = annotation(scope, 'a');
      await module.withContext(grant, () => module.store.appendAnnotationRevision(scope, 'a', record, { kind: 'creation', aggregateVersion: 0 }));
      await module.withContext(grant, async () => {
        await expect(module.store.getAnnotationHead({ ...scope, workspaceId: 'other' }, 'a')).rejects.toMatchObject({ code: 'denied' });
      });
      const readGrant = grantFor({ scope, token: 'reader', operations: ['read'] }); await root.bindNew(readGrant);
      await Promise.all([module.withContext(readGrant, async () => {
        expect((await module.store.getAnnotationHead(scope, 'a'))?.hash).toBe(record.hash);
        await expect(module.store.appendAnnotationRevision(scope, 'new', annotation(scope, 'new'), { kind: 'creation', aggregateVersion: 0 })).rejects.toMatchObject({ code: 'denied' });
      }), module.withContext(grant, () => module.store.appendAnnotationRevision(scope, 'b', annotation(scope, 'b'), { kind: 'creation', aggregateVersion: 0 }))]);
    } finally { await fixture.close(); }
  });
  it('preserves pending reads, rollback-only errors and stored-value genesis replay', async () => {
    const fixture = await createPgFixture(await createCommentsPostgresRegistration());
    try {
      const root = await fixture.open(); const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      const scope = conformanceScope(); const grant = grantFor({ scope }); await root.bindNew(grant);
      await module.withContext(grant, async () => {
        await expect(module.store.transaction().run(async () => {
          await module.store.appendAnnotationRevision(scope, 'rollback', annotation(scope, 'rollback'), { kind: 'creation', aggregateVersion: 0 });
          expect((await module.store.getAnnotationHead(scope, 'rollback'))?.annotationId).toBe('rollback');
          await module.store.appendAnnotationRevision(scope, 'bad', annotation(scope, 'bad'), { kind: 'revision', revisionHash: 'missing' }).catch(() => undefined);
        })).rejects.toMatchObject({ code: 'cas-conflict' });
        expect(await module.store.getAnnotationHead(scope, 'rollback')).toBeNull();
        const envelope = { scope, unitId: 'unit', manifestHash: 'manifest', issuedAt: 123 };
        const receipt = { kind: 'unit-receipt' as const, ...envelope, hash: hashRecord('unit-receipt', envelope) };
        await module.store.appendUnitReceipt(scope, 'unit', receipt);
        expect(await module.store.appendUnitReceipt(scope, 'unit', { ...receipt, manifestHash: 'ignored', issuedAt: 999 })).toEqual(receipt);
      });
    } finally { await fixture.close(); }
  });
});
