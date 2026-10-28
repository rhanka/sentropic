import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createKevAdapter, createKevQualificationDescriptor, KEV_INVENTORY, kevDescriptor,
  decisionExecutionDigest, decisionQualificationScope, discoverDecisionEvaluator } from '../src/decision/host.js';
import { parseKevDescriptor } from '../src/decision/kev-descriptor.js';
import { kevFixture } from './decision-kev-fixtures.js';

describe('Kev exact inventory and qualification scope', () => {
  it('should bind the checked-in runtime manifest to the library inventory', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../scripts/decision/kev-manifest.json', import.meta.url), 'utf8'));
    for (const [key, value] of Object.entries(KEV_INVENTORY.model)) expect(manifest.model[key]).toEqual(value);
    for (const [key, value] of Object.entries(KEV_INVENTORY.runtime)) {
      expect(key === 'archiveSha256' ? manifest.runtime.sha256 : manifest.runtime[key] ?? manifest.serving[key]).toEqual(value);
    }
    expect(manifest.serving.readout).toBe(KEV_INVENTORY.readout);
  });
  it.each([
    { model: { ...KEV_INVENTORY.model, file: 'Kev-4B-Q4_K_M.gguf' } },
    { model: { ...KEV_INVENTORY.model, revision: '0'.repeat(40) } },
    { model: { ...KEV_INVENTORY.model, sha256: '0'.repeat(64) } },
    { model: { ...KEV_INVENTORY.model, bytes: KEV_INVENTORY.model.bytes - 1 } },
    { model: { ...KEV_INVENTORY.model, quantization: 'Q4_K_M' } },
    { runtime: { ...KEV_INVENTORY.runtime, archiveSha256: '0'.repeat(64) } },
    { runtime: { ...KEV_INVENTORY.runtime, revision: '0'.repeat(40) } },
    { readout: 'other' },
  ])('should refuse a different selected artifact/runtime before serving (P26) %j', async (change) => {
    const f = kevFixture();
    expect(() => createKevQualificationDescriptor({ ...KEV_INVENTORY, ...change })).toThrow('inventory mismatch');
    f.verifyInventory.mockResolvedValue({ ...KEV_INVENTORY, ...change } as never);
    expect(await f.adapter.decision(f.request, { auth: f.auth })).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' } });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('should keep the shipped candidate unavailable and require complete inventory', async () => {
    const f = kevFixture();
    expect(() => createKevQualificationDescriptor(null)).toThrow();
    expect(await createKevAdapter({ transport: f.transport }).decision(f.request, { auth: f.auth }))
      .toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(discoverDecisionEvaluator(kevDescriptor)).toMatchObject({ identityQualified: false, billingQualified: false });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('should reject declarations that alter the pinned native compiler', () => {
    const f = kevFixture();
    for (const change of [{ compilation: { ...f.descriptor.compilation, readout: 'other' } },
      { wireModel: 'other-model' }, { maxBillableInputTokens: 4096 }, { maxBillableOutputTokens: 1 },
      { compilation: { ...f.descriptor.compilation, templateDigest: '0'.repeat(64) } }]) {
      expect(parseKevDescriptor({ ...f.descriptor, ...change })).toBeNull();
    }
  });
  it('should invalidate assessed execution when any model/runtime/compiler input changes (P27)', () => {
    const f = kevFixture();
    const baseline = decisionExecutionDigest(f.descriptor);
    for (const change of [{ compilation: { ...f.descriptor.compilation, readout: 'other' } },
      { compilation: { ...f.descriptor.compilation, templateDigest: '0'.repeat(64) } },
      { definition: { ...f.descriptor.definition, executionDigest: '0'.repeat(64) } },
      { scoreSemantics: { meaning: 'other-scale', meaningRef: 'fixture:changed' } }]) {
      expect(decisionExecutionDigest({ ...f.descriptor, ...change })).not.toBe(baseline);
    }
    const policy = { revision: 'fixture-v1', language: 'en', domain: 'fixture', intendedUse: 'test',
      maxInputBytes: 8192, decision: f.request.decision! };
    const scope = decisionQualificationScope(f.descriptor, f.request, policy)!;
    const changed = { ...f.request, criterion: { kind: 'binary' as const, instructions: 'Different rubric.' } };
    expect(decisionQualificationScope(f.descriptor, changed, policy)?.criterionDigest).not.toBe(scope.criterionDigest);
    expect(decisionQualificationScope(f.descriptor, f.request, { ...policy, decision: null })).toBeNull();
  });
});
