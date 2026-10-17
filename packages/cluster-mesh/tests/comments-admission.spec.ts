import { describe, expect, it } from 'vitest';
import { createAnnotationRevision, hashRecord } from '@sentropic/comments';
import { createCommentsFragment } from '../src/comments/fragment-codec.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe('separate comments module admission bounds', () => {
  const scope = conformanceScope();
  const record = () => createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('body'), provenance: conformanceProvenance() }, conformanceCapacity());
  const manifest = { scope, operationId: 'op', bindingDigest: 'a'.repeat(64), unitId: 'unit', ordinal: '0', predecessorHash: null, terminal: null };
  it.each(['segments', 'mentions', 'targets', 'shapes', 'depth'])('rejects excessive %s before fragment canonicalization', (bound) => {
    const value = record();
    if (bound === 'segments') value.body.segments = Array.from({ length: 65 }, () => ({ start: 0, end: 1, digest: 'a' }));
    if (bound === 'mentions') value.body.mentions = Array.from({ length: 65 }, () => ({ principal: 'p', displayText: 'b', start: 0, end: 1 }));
    if (bound === 'targets') value.secondary = Array.from({ length: 32 }, (_, index) => conformanceTarget(conformanceResource(scope, `r${index}`)));
    if (bound === 'shapes') value.visualAnchors = Array.from({ length: 129 }, () => ({}));
    if (bound === 'depth') { let fields = { leaf: 'value' }; for (let depth = 1; depth < 9; depth++) fields = { nested: fields }; value.body.profile = { schemaId: 'profile', version: 'v1', digest: 'd', fields }; }
    const { kind, hash: _hash, ...envelope } = value; value.hash = hashRecord(kind, envelope);
    expect(() => createCommentsFragment(manifest, [value])).toThrow(/admission|segments|mentions|targets|shapes|depth/i);
  });
  it('keeps the frozen capacity descriptor unchanged and accepts the ordinary record', () => {
    expect(() => createCommentsFragment(manifest, [record()])).not.toThrow();
    expect(Object.keys(conformanceCapacity())).not.toContain('profileDepth');
  });
  it('permits acyclic shared profile objects without treating aliases as recursion', () => {
    const value = record(); const shared = { leaf: 'value' };
    value.body.profile = { schemaId: 'profile', version: 'v1', digest: 'd', fields: { left: shared, right: shared } };
    const { kind, hash: _hash, ...envelope } = value; value.hash = hashRecord(kind, envelope);
    expect(() => createCommentsFragment(manifest, [value])).not.toThrow();
  });
});
