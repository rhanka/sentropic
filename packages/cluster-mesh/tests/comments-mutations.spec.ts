import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { createAnnotationRevision, hashRecord } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { CommentsContext } from '../src/comments/context.js';
import { CommentsAdapter } from '../src/comments/storage-adapter.js';
import * as schema from '../src/comments/storage-schema.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
const probe = async (kind: 'scope' | 'genesis' | 'resource') => {
  const fixture = await createPgFixture(await createCommentsPostgresRegistration());
  try {
    const root = await fixture.open(); const scope = conformanceScope(); const grant = grantFor({ scope }); const bound = await root.bindNew(grant);
    const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
    await module.withContext(grant, async () => {
      if (kind === 'genesis') {
        const envelope = { scope, unitId: 'u', manifestHash: 'original', issuedAt: 123 };
        const record = { kind: 'unit-receipt' as const, ...envelope, hash: hashRecord('unit-receipt', envelope) };
        await module.store.appendUnitReceipt(scope, 'u', record);
        assert.deepEqual(await module.store.appendUnitReceipt(scope, 'u', { ...record, manifestHash: 'changed', issuedAt: 999 }), record, 'Comments genesis probe: original manifest and issuance survive replay');
        return;
      }
      for (const namespace of ['a', 'b']) {
        const record = createAnnotationRevision(null, { scope, annotationId: namespace, primary: conformanceTarget({ ...conformanceResource(scope, 'same-id'), namespace }), secondary: [], visualAnchors: [], body: conformanceBody('private'), provenance: conformanceProvenance() }, conformanceCapacity());
        await module.store.appendAnnotationRevision(scope, namespace, record, { kind: 'creation', aggregateVersion: 0 });
      }
      if (kind === 'scope') await assert.rejects(() => module.store.getAnnotationHead({ ...scope, workspaceId: 'foreign' }, 'a'), { code: 'denied' }, 'Comments scope probe: method scope must equal the current issued grant');
      else assert.equal((await bound.query('by-resource', { resource: { ...conformanceResource(scope, 'same-id'), namespace: 'a' } }, { limit: 100 })).records.length, 1, 'Comments resource probe: namespace is part of resource identity');
    });
  } finally { await fixture.close(); }
};
describe.skipIf(!pgEnabled)('discriminating comments production mutations', () => {
  it('kills an omitted request-scope comparison', async () => {
    await probe('scope'); const original = CommentsContext.prototype.current;
    const mutant = vi.spyOn(CommentsContext.prototype, 'current').mockImplementation(function () { return original.call(this); });
    try { await expect(probe('scope')).rejects.toThrow(/Comments scope probe/); } finally { mutant.mockRestore(); }
  });
  it('kills genesis replay returning the incoming representation', async () => {
    await probe('genesis'); const original = CommentsAdapter.prototype.append;
    const mutant = vi.spyOn(CommentsAdapter.prototype, 'append').mockImplementation(async function (scope, selection, record, expected) {
      const stored = await original.call(this, scope, selection, record, expected); return selection.kind === 'unit-receipts' ? record : stored;
    });
    try { await expect(probe('genesis')).rejects.toThrow(/Comments genesis probe/); } finally { mutant.mockRestore(); }
  });
  it('kills bare resource IDs in actual projection writes and registered query reads', async () => {
    await probe('resource'); const mutant = vi.spyOn(schema, 'commentsResourceKey').mockImplementation((resource) => resource.id);
    try { await expect(probe('resource')).rejects.toThrow(/Comments resource probe/); } finally { mutant.mockRestore(); }
  });
});
