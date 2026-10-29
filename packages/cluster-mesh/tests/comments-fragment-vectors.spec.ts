import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, createAnnotationRevision } from '@sentropic/comments';
import { createCommentsFragment, validateCommentsFragment, commentsFragmentDigest, commentsUnitPayloadDigest } from '../src/comments/fragment-codec.js';
import { COMMENTS_TRANSPORT_VERSION } from '../src/comments/transport-contracts.js';
import { isDecimalCounter, parseDecimalCounter } from '../src/storage/contracts.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe('comments transport-v1 fragment framing', () => {
  it('matches the shipped literal multibyte/escaping and terminal vectors', () => {
    const bytes = readFileSync(new URL('../assets/storage/comments/transport-v1.json', import.meta.url), 'utf8');
    expect(bytes).toBe(readFileSync(new URL('../../../docs/comments-annotations/contract/transport-v1.json', import.meta.url), 'utf8'));
    const vectors = JSON.parse(bytes);
    for (const fragment of vectors.fragments) { validateCommentsFragment(fragment); expect(createCommentsFragment(fragment.manifest, fragment.payload)).toEqual(fragment); }
    expect(commentsUnitPayloadDigest(vectors.unitRoot.unitId, vectors.fragments[0].payload)).toBe(vectors.unitRoot.payloadDigest);
  });
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
  it('keeps the original safe-only counter domain and encoded bytes', () => {
    expect(isDecimalCounter('9007199254740991')).toBe(true);
    expect(isDecimalCounter('9007199254740992')).toBe(false);
    expect(parseDecimalCounter('9007199254740991')).toBe(9007199254740991);
    expect(parseDecimalCounter('9007199254740992')).toBe(null);
    // A data fragment valid in every field except an above-safe ordinal must
    // fail exactly on the counter domain: valid predecessor hash, computed
    // digest, non-empty payload. Widening the domain would let it through.
    const scope = conformanceScope();
    const record = createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('quote'), provenance: conformanceProvenance() }, conformanceCapacity());
    const manifestBase = { scope, operationId: 'operation', bindingDigest: 'a'.repeat(64), unitId: 'unit', predecessorHash: 'b'.repeat(64), terminal: null };
    const safe = createCommentsFragment({ ...manifestBase, ordinal: '9007199254740991' }, [record]);
    validateCommentsFragment(safe);
    const manifest = { ...manifestBase, ordinal: '9007199254740992' };
    const digest = commentsFragmentDigest(manifest, [record]);
    expect(() => validateCommentsFragment({ version: COMMENTS_TRANSPORT_VERSION, manifest, payload: [record], digest })).toThrow(/invalid fragment identity or frontier/);
  });
});
