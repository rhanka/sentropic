import { describe, expect, it, vi } from 'vitest';
import {
  createOpsPlatformAdminsPort,
  createOpsRecipientsPort,
  parseOpsRecipientsUrls,
  parseOpsTargetsDeclaration,
  parseOpsTargetsDeclarationStrict,
} from '../../../src/services/notifications/ops-recipients';

const accounts = (records: Record<string, { status: 'active' | 'disabled'; email: string }>) => ({
  findAccount: async (accountId: string) => {
    const record = records[accountId];
    return record ? { accountStatus: record.status, email: record.email } : null;
  },
});

const platformAdmins = [{ accountId: 'u-platform', email: 'platform@example.com', basis: 'platform-admin-fallback' }];

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
      { accountId: 'u-owner', email: 'owner@example.com', basis: 'platform-declaration:immo-prod' },
      { accountId: 'u-farid', email: 'farid@example.com', basis: 'platform-declaration:immo-prod' },
    ]);
  });

  it('fails closed with an empty list when the target has no usable admin', async () => {
    const port = createOpsRecipientsPort({
      declaration: {},
      accounts: accounts({}),
      platformAdmins: async () => platformAdmins,
    });
    expect(await port.listRecipientsForTarget('unknown-target')).toEqual([]);
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
      { accountId: 'u-ok', email: 'ok@example.com', basis: 'platform-declaration:immo-prod' },
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
      { accountId: 'u-1', email: 'live@example.com', basis: 'platform-declaration:immo-prod' },
    ]);
    expect(lookup.findAccount).toHaveBeenCalledWith('u-1');
  });
});

describe('parseOpsTargetsDeclarationStrict', () => {
  it('rejects malformed declarations at startup instead of degrading silently', () => {
    expect(() => parseOpsTargetsDeclarationStrict('not-json')).toThrow(/valid JSON/);
    expect(() => parseOpsTargetsDeclarationStrict('["immo-prod"]')).toThrow(/must be an object/);
    expect(() => parseOpsTargetsDeclarationStrict('{"immo-prod":"u-1"}')).toThrow(/must be an array/);
    expect(parseOpsTargetsDeclarationStrict('{"immo-prod":["u-1"]}')).toEqual({ 'immo-prod': ['u-1'] });
    expect(parseOpsTargetsDeclarationStrict(undefined)).toEqual({});
  });
});

describe('product pull recipientsUrls', () => {
  const T0 = '2026-11-09T10:00:00.000Z';
  const answer = {
    v: 1, target: 'immo-prod', asOf: T0,
    admins: [{ accountRef: 'u-product', email: 'product-admin@example.com', basis: ['app:is_admin'] }],
  };

  it('resolves a configured target through the validated product answer', async () => {
    const seen: string[] = [];
    const port = createOpsRecipientsPort({
      declaration: { 'immo-prod': ['u-declared'] },
      accounts: accounts({ 'u-declared': { status: 'active', email: 'declared@example.com' } }),
      recipientsUrls: { 'immo-prod': 'https://immo.example.com/api/v1/ops/recipients' },
      fetchFn: async (url) => {
        seen.push(url);
        return { ok: true, status: 200, json: async () => answer };
      },
      now: () => T0,
    });
    expect(await port.listRecipientsForTarget('immo-prod')).toEqual([
      { accountId: 'u-product', email: 'product-admin@example.com', basis: 'app:is_admin' },
    ]);
    expect(seen[0]).toContain('target=immo-prod');
  });

  it('keeps unconfigured targets on the declaration and fails closed on pull errors', async () => {
    const port = createOpsRecipientsPort({
      declaration: { other: ['u-declared'] },
      accounts: accounts({ 'u-declared': { status: 'active', email: 'declared@example.com' } }),
      recipientsUrls: { 'immo-prod': 'https://immo.example.com/api/v1/ops/recipients' },
      fetchFn: async () => { throw new Error('product down'); },
      now: () => T0,
    });
    expect(await port.listRecipientsForTarget('other')).toEqual([
      { accountId: 'u-declared', email: 'declared@example.com', basis: 'platform-declaration:other' },
    ]);
    await expect(port.listRecipientsForTarget('immo-prod')).rejects.toThrow();
  });

  it('parses the urls map and drops non-https entries', () => {
    expect(parseOpsRecipientsUrls(undefined)).toEqual({});
    expect(parseOpsRecipientsUrls('not-json')).toEqual({});
    expect(parseOpsRecipientsUrls('{"immo-prod":"https://immo.example.com/r","bad":"ftp://x"}')).toEqual({
      'immo-prod': 'https://immo.example.com/r',
    });
  });
});

describe('createOpsPlatformAdminsPort', () => {
  it('resolves only active admin_app accounts with sendable addresses', async () => {
    const port = createOpsPlatformAdminsPort({
      platformAdmins: async () => platformAdmins,
    });
    expect(await port.listRecipientsForTarget('immo-prod')).toEqual(platformAdmins);
  });

  it('propagates lookup failures so the sweep retries instead of alerting wrongly', async () => {
    const port = createOpsPlatformAdminsPort({
      platformAdmins: async () => { throw new Error('idp down'); },
    });
    await expect(port.listRecipientsForTarget('immo-prod')).rejects.toThrow('idp down');
  });
});
