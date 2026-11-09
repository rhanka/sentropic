import { describe, expect, it, vi } from 'vitest';
import {
  createOpsRecipientsPort,
  parseOpsTargetsDeclaration,
} from '../../../src/services/notifications/ops-recipients';

const accounts = (records: Record<string, { status: 'active' | 'disabled'; email: string }>) => ({
  findAccount: async (accountId: string) => {
    const record = records[accountId];
    return record ? { accountStatus: record.status, email: record.email } : null;
  },
});

const platformAdmins = [{ accountId: 'u-platform', email: 'platform@example.com' }];

describe('parseOpsTargetsDeclaration', () => {
  it('parses a target to account-ids map and drops empty entries', () => {
    expect(parseOpsTargetsDeclaration('{"immo-prod":["u-1","u-2"],"empty":[]}')).toEqual({
      'immo-prod': ['u-1', 'u-2'],
    });
  });

  it('degrades malformed JSON to an empty declaration', () => {
    expect(parseOpsTargetsDeclaration('not-json')).toEqual({});
    expect(parseOpsTargetsDeclaration(undefined)).toEqual({});
  });
});

describe('createOpsRecipientsPort', () => {
  it('resolves every alert to all declared admins of the target (no split)', async () => {
    const port = createOpsRecipientsPort({
      declaration: { 'immo-prod': ['u-owner', 'u-farid'] },
      accounts: accounts({
        'u-owner': { status: 'active', email: 'owner@example.com' },
        'u-farid': { status: 'active', email: 'farid@example.com' },
      }),
      platformAdmins: async () => platformAdmins,
    });
    expect(await port.listRecipientsForTarget('immo-prod')).toEqual([
      { accountId: 'u-owner', email: 'owner@example.com' },
      { accountId: 'u-farid', email: 'farid@example.com' },
    ]);
  });

  it('falls back to platform admins when the target has no usable admin', async () => {
    const port = createOpsRecipientsPort({
      declaration: {},
      accounts: accounts({}),
      platformAdmins: async () => platformAdmins,
    });
    expect(await port.listRecipientsForTarget('unknown-target')).toEqual(platformAdmins);
  });

  it('skips declared ids that are missing or inactive', async () => {
    const port = createOpsRecipientsPort({
      declaration: { 'immo-prod': ['u-ok', 'u-ghost', 'u-off'] },
      accounts: accounts({
        'u-ok': { status: 'active', email: 'ok@example.com' },
        'u-off': { status: 'disabled', email: 'off@example.com' },
      }),
      platformAdmins: async () => platformAdmins,
    });
    expect(await port.listRecipientsForTarget('immo-prod')).toEqual([
      { accountId: 'u-ok', email: 'ok@example.com' },
    ]);
  });

  it('never hardcodes emails: addresses always come from the account store', async () => {
    const lookup = {
      findAccount: vi.fn(async () => ({ accountStatus: 'active' as const, email: 'live@example.com' })),
    };
    const port = createOpsRecipientsPort({
      declaration: { 'immo-prod': ['u-1'] },
      accounts: lookup,
      platformAdmins: async () => [],
    });
    expect(await port.listRecipientsForTarget('immo-prod')).toEqual([
      { accountId: 'u-1', email: 'live@example.com' },
    ]);
    expect(lookup.findAccount).toHaveBeenCalledWith('u-1');
  });
});
