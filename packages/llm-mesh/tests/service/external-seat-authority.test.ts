import { describe, expect, it } from 'vitest';
import { AccountTransportAcquireError } from '../../src/account-transports.js';
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
