import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, createAnnotationRevision } from '@sentropic/comments';
import { createCommentsFragment, validateCommentsFragment, commentsUnitPayloadDigest } from '../src/comments/fragment-codec.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe('comments transport-v1 fragment framing', () => {
  it('matches an independent framed UTF-8 vector and owns nested payloads', () => {
    const scope = conformanceScope();
    const record = createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('quote " slash \\ emoji 🦊'), provenance: conformanceProvenance() }, conformanceCapacity());
    const manifest = { scope, operationId: 'operation', bindingDigest: 'a'.repeat(64), unitId: 'unit', ordinal: '0', predecessorHash: null, terminal: null };
    const fragment = createCommentsFragment(manifest, [record]);
    const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
    expect(fragment.digest).toBe(sha(['comments-fragment', 'v1', manifest, [record]]));
    expect(commentsUnitPayloadDigest('unit', [record])).toBe(sha(['comments-unit-payload', 'v1', 'unit', [[record.kind, record.hash]]]));
    record.body.text = 'caller mutation';
    expect(fragment.payload[0].body.text).toContain('🦊'); validateCommentsFragment(fragment);
    expect(() => validateCommentsFragment({ ...fragment, manifest: { ...fragment.manifest, ordinal: '01' } })).toThrow();
    expect(() => validateCommentsFragment({ ...fragment, payload: [] })).toThrow();
    expect(() => validateCommentsFragment({ ...fragment, manifest: { ...fragment.manifest, predecessorHash: 'b'.repeat(64) } })).toThrow();
  });
  it('counts canonical payload, manifest and complete envelope bytes separately', () => {
    const scope = conformanceScope();
    const manifest = { scope, operationId: 'operation', bindingDigest: 'a'.repeat(64), unitId: 'unit', ordinal: '0', predecessorHash: null, terminal: null };
    const large = { kind: 'unit-receipt', scope, unitId: 'unit', manifestHash: 'm', issuedAt: 1, hash: 'h', extra: '🦊'.repeat(140000) };
    expect(() => createCommentsFragment(manifest, [large])).toThrow(/payload/i);
    expect(() => createCommentsFragment({ ...manifest, operationId: 'x'.repeat(70000) }, [])).toThrow();
  });
});
