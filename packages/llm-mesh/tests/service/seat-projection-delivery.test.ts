import { describe, expect, it } from 'vitest';
import {
  parseCliSeatProfile,
  parseTokenSeatEnvelope,
  sameSeatLineage,
} from '../../src/enrollment/cli-seat-import.js';
import { validateSeatBundle } from '../../src/enrollment/seat-bundle.js';

// Mesh-side projection delivery: the custodian hands a consumer projection
// to the mesh importer. Lineage and owner survive the handoff; refresh
// material never does. Application persistence/ack is covered API-side.

describe('seat-projection-delivery', () => {
  const delivered = () => {
    const fromCli = parseCliSeatProfile({
      cli: 'claude',
      seatRef: 'seat-delivery-01',
      refreshFamilyRef: 'family-delivery-01',
      ownerScope: 'owner-seat-01',
      issuingClientRef: 'client-delivery-01',
      endpointFamily: 'endpoint-delivery-01',
      accountBinding: 'binding-delivery-01',
      entitlementClass: 'lab-seat',
      epoch: 1,
      generation: 4,
      operationId: 'op-delivery-01',
      accessRef: 'access-delivery-01',
    });
    return parseTokenSeatEnvelope({ raw: JSON.stringify(fromCli), ownerScope: 'owner-seat-01' });
  };

  it('delivers a consumer projection with lineage and owner intact', () => {
    const projection = delivered();
    expect(projection.authority).toBe('consumer');
    expect(projection.lifecycle).toMatchObject({ epoch: 1, generation: 4, refreshAuthority: 'none' });
    expect(projection.meshUse).toMatchObject({ kind: 'access', accessRef: 'access-delivery-01' });
    expect(projection.canonical).toBeUndefined();
  });

  it('keeps N and N+1 distinct while reimporting N idempotently', () => {
    const first = delivered();
    const replay = parseTokenSeatEnvelope({
      raw: JSON.stringify(first),
      ownerScope: 'owner-seat-01',
    });
    expect(sameSeatLineage(first, replay)).toBe(true);
    const successor = { ...first, lifecycle: { ...first.lifecycle, generation: 5, operationId: 'op-delivery-02' } };
    expect(sameSeatLineage(first, successor)).toBe(false);
    expect(
      validateSeatBundle(successor, {
        ownerScope: 'owner-seat-01',
        trustedAuthority: 'consumer',
        predecessor: { epoch: 1, generation: 4, operationId: 'op-delivery-01' },
      }).ok,
    ).toBe(true);
  });

  it('refuses a delivered projection carrying refresh material', () => {
    const projection = delivered();
    const tampered = { ...projection, meshUse: { kind: 'access', accessRef: 'x', refreshToken: 'smuggled' } };
    expect(
      validateSeatBundle(tampered, { ownerScope: 'owner-seat-01', trustedAuthority: 'consumer' }),
    ).toMatchObject({ ok: false, code: 'refresh-material-present' });
  });

  it('refuses delivery to another owner', () => {
    const projection = delivered();
    expect(() =>
      parseTokenSeatEnvelope({ raw: JSON.stringify(projection), ownerScope: 'owner-other-01' }),
    ).toThrow(/owner/);
  });
});
