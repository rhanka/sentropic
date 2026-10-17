import { describe, expect, it, vi } from 'vitest';
import { AccountTransportAcquireError } from '../../src/account-transports.js';
import type { EnrollmentProvider } from '../../src/enrollment/contracts.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';
import {
  SEAT_EXTERNAL_AUTHORITY_KEY,
  isDeviceFlowSeatAccount,
  isExternalSeatAccount,
  markExternalSeatAuthority,
  readExternalSeatAuthority,
  throwDeviceFlowSeatUnavailable,
  throwExternalSeatUnavailable,
} from '../../src/service/external-seat-authority.js';

const authority = {
  seatRef: 'seat-synth-muse-01',
  ownerScope: 'owner-synth-01',
  epoch: 1,
  generation: 3,
  operationId: 'op-synth-01',
};

describe('external-seat-authority', () => {
  it('marks and reads a trusted external seat', () => {
    const metadata = markExternalSeatAuthority({ productAccountSource: 'antigravity' }, authority);
    expect(metadata[SEAT_EXTERNAL_AUTHORITY_KEY]).toMatchObject({ seatRef: 'seat-synth-muse-01' });
    expect(metadata['productAccountSource']).toBe('antigravity');
    expect(readExternalSeatAuthority(metadata)).toMatchObject(authority);
    expect(isExternalSeatAccount({ accountId: 'a', metadata })).toBe(true);
  });

  it('treats absent markers as mesh-managed', () => {
    expect(readExternalSeatAuthority(undefined)).toBeNull();
    expect(isExternalSeatAccount({ accountId: 'a', metadata: {} })).toBe(false);
  });

  it('stays fail-closed on a malformed marker', () => {
    expect(isExternalSeatAccount({ accountId: 'a', metadata: { [SEAT_EXTERNAL_AUTHORITY_KEY]: 'yes' } })).toBe(true);
  });

  it('refuses renewal with a classified access-unavailable error', () => {
    const metadata = markExternalSeatAuthority(undefined, authority);
    try {
      throwExternalSeatUnavailable({ accountId: 'acct-01', metadata });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AccountTransportAcquireError);
      expect((error as AccountTransportAcquireError).code).toBe('access-unavailable');
      expect(String((error as Error).message)).toContain('access-unavailable');
    }
  });

  it('routes device-flow Muse seats away from the CLI-store refresh', () => {
    const device = { accountId: 'acct-muse-device-01', metadata: { auth_type: 'device-flow' } };
    const cli = { accountId: 'acct-muse-cli-01', metadata: { auth_type: 'cli-import' } };
    expect(isDeviceFlowSeatAccount(device)).toBe(true);
    expect(isDeviceFlowSeatAccount(cli)).toBe(false);
    expect(() => throwDeviceFlowSeatUnavailable(device)).toThrowError(
      expect.objectContaining({ code: 'access-unavailable' }),
    );
  });
});

describe('external-seat-authority acquisition guard', () => {
  const setup = (refresh = vi.fn()) => {
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(),
      new Map<string, EnrollmentProvider>([['muse', { refresh } as unknown as EnrollmentProvider]]),
      { async resolveConfig() { return {}; } },
    );
    return { service, refresh };
  };

  it('refuses refresh of an expired external seat with zero provider calls', async () => {
    const { service, refresh } = setup();
    service.registerAccount({
      accountId: 'acct-external-01',
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      accessToken: 'stale-access',
      expiresAt: '2000-01-01T00:00:00Z',
      status: 'active',
      ownerScopeRef: 'owner-synth-01',
      metadata: markExternalSeatAuthority(undefined, { ...authority, seatRef: 'seat-synth-01' }),
    });
    await expect(
      service.acquire({ targetProviderId: 'muse', transportProviderId: 'muse', ownerScopeRef: 'owner-synth-01' }),
    ).rejects.toMatchObject({
      code: 'access-unavailable',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns valid unexpired external access directly with the policy retained', async () => {
    const { service, refresh } = setup();
    const metadata = markExternalSeatAuthority({ productAccountSource: 'antigravity' }, authority);
    service.registerAccount({
      accountId: 'acct-external-02',
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      accessToken: 'current-access',
      expiresAt: '2099-01-01T00:00:00Z',
      status: 'active',
      ownerScopeRef: 'owner-synth-01',
      metadata,
    });
    const acquisition = await service.acquire({
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      ownerScopeRef: 'owner-synth-01',
    });
    expect(acquisition.material.accessToken).toBe('current-access');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('never re-reads the CLI store for an expired device-flow Muse seat', async () => {
    const deviceCredential = {
      accountId: 'acct-muse-device-09',
      accessToken: 'device-access',
      refreshToken: 'device-refresh',
      expiresAt: '2000-01-01T00:00:00Z',
      authClientConfigVersion: 'v1.0.0',
    };
    const museCode = {
      pollForCompletion: vi.fn(async () => ({
        accountId: deviceCredential.accountId,
        label: 'Muse (device)',
        ownerScope: 'owner-synth-01',
        credential: deviceCredential,
      })),
    } as unknown as EnrollmentProvider;
    const refresh = vi.fn();
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(),
      new Map<string, EnrollmentProvider>([
        ['muse-code', museCode],
        ['muse', { refresh } as unknown as EnrollmentProvider],
      ]),
      { async resolveConfig() { return {}; } },
    );
    const completion = await service.completeMuseDeviceImport('enroll-device-01', 'owner-synth-01');
    expect(completion.accountId).toBe(deviceCredential.accountId);
    await expect(
      service.acquire({ targetProviderId: 'muse', transportProviderId: 'muse', ownerScopeRef: 'owner-synth-01' }),
    ).rejects.toMatchObject({ code: 'access-unavailable' });
    expect(museCode.pollForCompletion).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
