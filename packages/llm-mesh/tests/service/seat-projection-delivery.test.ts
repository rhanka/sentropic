import { describe, expect, it } from 'vitest';
import {
  parseCliSeatProfile,
  parseTokenSeatEnvelope,
  sameSeatLineage,
} from '../../src/enrollment/cli-seat-import.js';
import { validateSeatBundle } from '../../src/enrollment/seat-bundle.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';

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

describe('seat-bundle canonical registration', () => {
  const consumerBundle = (overrides = {}) => ({
    cli: 'claude' as const,
    seatRef: 'seat-reg-01',
    refreshFamilyRef: 'family-reg-01',
    ownerScope: 'owner-seat-01',
    issuingClientRef: 'client-reg-01',
    endpointFamily: 'endpoint-reg-01',
    accountBinding: 'binding-reg-01',
    entitlementClass: 'lab-seat',
    epoch: 1,
    generation: 1,
    operationId: 'op-reg-01',
    issuedAt: '2026-10-17T00:00:00Z',
    providerExpiry: '2099-01-01T00:00:00Z',
    accessRef: 'access-reg-01',
    ...overrides,
  });
  const serviceOn = (keyring = new InMemoryKeyring()) =>
    new LocalAccountTransportService(keyring, new Map(), { async resolveConfig() { return {}; } });

  it('registers a consumer projection and serves it without a second registry', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = parseCliSeatProfile(consumerBundle());
    const imported = await service.importSeatBundle({ bundle, ownerScope: 'owner-seat-01' });
    expect(imported.idempotent).toBe(false);
    const acquisition = await service.acquire({
      targetProviderId: 'anthropic',
      transportProviderId: 'claude-code',
      ownerScopeRef: 'owner-seat-01',
    });
    expect(acquisition.material.accessToken).toBe('access-reg-01');
  });

  it('survives a restart and classifies expiry after reload', async () => {
    const keyring = new InMemoryKeyring();
    await serviceOn(keyring).importSeatBundle({ bundle: parseCliSeatProfile(consumerBundle()), ownerScope: 'owner-seat-01' });
    const restored = serviceOn(keyring);
    const acquisition = await restored.acquire({
      targetProviderId: 'anthropic',
      transportProviderId: 'claude-code',
      ownerScopeRef: 'owner-seat-01',
    });
    expect(acquisition.material.accessToken).toBe('access-reg-01');
    await serviceOn(keyring).importSeatBundle({
      bundle: parseCliSeatProfile(consumerBundle({ generation: 2, operationId: 'op-reg-02', accessRef: 'access-reg-02', providerExpiry: '2000-01-01T00:00:00Z' })),
      ownerScope: 'owner-seat-01',
    });
    await expect(
      serviceOn(keyring).acquire({
        targetProviderId: 'anthropic',
        transportProviderId: 'claude-code',
        ownerScopeRef: 'owner-seat-01',
      }),
    ).rejects.toMatchObject({ code: 'access-unavailable' });
  });

  it('reimports N idempotently and refuses N-1 and new epochs', async () => {
    const service = serviceOn();
    const bundle = parseCliSeatProfile(consumerBundle());
    await service.importSeatBundle({ bundle, ownerScope: 'owner-seat-01' });
    const replay = await service.importSeatBundle({ bundle, ownerScope: 'owner-seat-01' });
    expect(replay.idempotent).toBe(true);
    await expect(
      service.importSeatBundle({
        bundle: parseCliSeatProfile(consumerBundle({ generation: 0, operationId: 'op-reg-00' })),
        ownerScope: 'owner-seat-01',
      }),
    ).rejects.toThrow(/stale-generation/);
    await expect(
      service.importSeatBundle({
        bundle: parseCliSeatProfile(consumerBundle({ epoch: 2, operationId: 'op-reg-epoch-2' })),
        ownerScope: 'owner-seat-01',
      }),
    ).rejects.toThrow(/epoch-replacement-required/);
  });

  it('refuses wrong-owner, refresh-bearing, and dateless bundles', async () => {
    const service = serviceOn();
    const bundle = parseCliSeatProfile(consumerBundle());
    await expect(service.importSeatBundle({ bundle, ownerScope: 'owner-other-01' })).rejects.toThrow(/owner/);
    const renewable = { ...bundle, credentialClass: 'renewable' };
    await expect(service.importSeatBundle({ bundle: renewable, ownerScope: 'owner-seat-01' })).rejects.toThrow();
    const dateless = parseCliSeatProfile(consumerBundle({ providerExpiry: undefined }));
    await expect(
      service.importSeatBundle({ bundle: dateless, ownerScope: 'owner-seat-01' }),
    ).rejects.toThrow(/expiry/);
  });
});
