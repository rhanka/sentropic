import { describe, expect, it } from 'vitest';
import {
  SEAT_AGY_APPLICATION_TUPLE,
  SEAT_BUNDLE_MAX_BYTES,
  SEAT_PACKAGE_PROVIDER_ID,
  createReceipt,
  isIdempotentReimport,
  isStaleGeneration,
  resolveEffectiveAuthority,
  validateSeatBundle,
} from '../../src/enrollment/seat-bundle.js';
import type { SeatBundleV1, SeatCli } from '../../src/enrollment/seat-bundle.js';

const CLIS: SeatCli[] = ['agy', 'codex', 'vibe', 'muse', 'claude'];

function canonical(cli: SeatCli): SeatBundleV1 {
  return {
    identity: {
      schemaVersion: 1,
      seatRef: `seat-synth-${cli}-01`,
      refreshFamilyRef: `family-synth-${cli}-01`,
      ownerScope: 'owner-synth-01',
      cli,
      packageProviderId: SEAT_PACKAGE_PROVIDER_ID[cli],
      credentialFormatVersion: 'v1',
      os: 'linux',
    },
    provenance: { enrollmentSource: 'cli', accountBinding: `binding-synth-${cli}-01`, entitlementClass: 'lab-seat' },
    authority: 'custodian',
    credentialClass: 'renewable',
    lifecycle: {
      epoch: 1,
      generation: 1,
      operationId: `op-synth-${cli}-01`,
      issuedAt: '2026-10-15T00:00:00Z',
      localExpiryPolicy: 'synthetic-policy-01',
      refreshAuthority: 'custody',
    },
    canonical: { kind: 'renewable-material', materialRef: `material-synth-${cli}-01` },
    meshUse: { kind: 'access', accessRef: `access-synth-${cli}-01` },
  };
}

function consumer(cli: SeatCli): SeatBundleV1 {
  const bundle = canonical(cli);
  return {
    ...bundle,
    authority: 'consumer',
    credentialClass: 'access-only',
    lifecycle: { ...bundle.lifecycle, refreshAuthority: 'none' },
    canonical: undefined,
  };
}

describe('seat-bundle envelope', () => {
  it.each(CLIS)('accepts a synthetic canonical bundle for %s', (cli) => {
    const result = validateSeatBundle(canonical(cli), { ownerScope: 'owner-synth-01' });
    expect(result.ok).toBe(true);
  });

  it.each(CLIS)('accepts a refresh-less consumer projection for %s', (cli) => {
    const result = validateSeatBundle(consumer(cli), { ownerScope: 'owner-synth-01' });
    expect(result.ok).toBe(true);
  });

  it('rejects an oversize bundle', () => {
    const bundle = canonical('codex');
    bundle.provenance.entitlementClass = `lab-seat-${'x'.repeat(SEAT_BUNDLE_MAX_BYTES)}`;
    const result = validateSeatBundle(bundle);
    expect(result).toMatchObject({ ok: false, code: 'size-exceeded' });
  });

  it('rejects an owner mismatch', () => {
    const result = validateSeatBundle(canonical('muse'), { ownerScope: 'owner-synth-02' });
    expect(result).toMatchObject({ ok: false, code: 'owner-mismatch' });
  });

  it('rejects a wrong layer mapping for agy', () => {
    const bundle = canonical('agy');
    bundle.identity.packageProviderId = 'gemini';
    expect(validateSeatBundle(bundle)).toMatchObject({ ok: false, code: 'client-mismatch' });
  });

  it('rejects an unknown top-level field', () => {
    const bundle = { ...consumer('vibe'), opaqueExtension: { note: 'synthetic' } };
    expect(validateSeatBundle(bundle)).toMatchObject({ ok: false, code: 'unknown-field' });
  });

  it('rejects direct refresh material in a consumer projection', () => {
    const bundle = { ...consumer('claude'), meshUse: { kind: 'access', refreshToken: 'synthetic' } };
    expect(validateSeatBundle(bundle)).toMatchObject({ ok: false, code: 'refresh-material-present' });
  });

  it('rejects a nested renewal field in a consumer projection', () => {
    const bundle = {
      ...consumer('codex'),
      meshUse: { kind: 'access', accessRef: 'synthetic', nativeProfile: { refresh_token: 'synthetic' } },
    };
    expect(validateSeatBundle(bundle)).toMatchObject({ ok: false, code: 'nested-refresh-field' });
  });

  it('rejects authority escalation through bundle data', () => {
    const withCanonical = { ...consumer('agy'), canonical: { kind: 'renewable-material', materialRef: 'synthetic' } };
    expect(validateSeatBundle(withCanonical)).toMatchObject({ ok: false, code: 'authority-escalation' });
    const renewable = { ...consumer('muse'), credentialClass: 'renewable' as const };
    expect(validateSeatBundle(renewable)).toMatchObject({ ok: false, code: 'authority-escalation' });
    expect(resolveEffectiveAuthority('custodian', 'consumer')).toBe('consumer');
  });

  it('refuses rollback but reimports the same tuple idempotently', () => {
    const current = { epoch: 1, generation: 2, operationId: 'op-synth-02' };
    expect(isStaleGeneration(current, { epoch: 1, generation: 1 })).toBe(true);
    expect(isStaleGeneration(current, { epoch: 1, generation: 2 })).toBe(false);
    expect(isIdempotentReimport(current, { epoch: 1, generation: 2, operationId: 'op-synth-02' })).toBe(true);
    expect(isIdempotentReimport(current, { epoch: 1, generation: 2, operationId: 'op-synth-03' })).toBe(false);
  });

  it('keeps static keys family-free and requires families otherwise', () => {
    const staticBundle = { ...consumer('vibe'), credentialClass: 'static-key' as const };
    delete staticBundle.identity.refreshFamilyRef;
    expect(validateSeatBundle(staticBundle).ok).toBe(true);
    const familyFree = canonical('vibe');
    delete familyFree.identity.refreshFamilyRef;
    expect(validateSeatBundle(familyFree)).toMatchObject({ ok: false, code: 'schema-mismatch' });
  });

  it('emits credential-free receipts and freezes the agy mapping', () => {
    const bundle = canonical('agy');
    const receipt = createReceipt(bundle, 'valid', undefined, '2026-10-15T00:00:00Z');
    expect(receipt).toMatchObject({ seatRef: 'seat-synth-agy-01', cli: 'agy', outcome: 'valid' });
    expect(JSON.stringify(receipt)).not.toMatch(/Token|material/i);
    expect(SEAT_AGY_APPLICATION_TUPLE).toEqual({
      transportProviderId: 'antigravity',
      targetProviderId: 'cloudcode-pa',
      productAccountSource: 'antigravity',
    });
  });
});
