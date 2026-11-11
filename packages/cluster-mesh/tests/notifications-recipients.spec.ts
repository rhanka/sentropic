import { describe, expect, it, vi } from 'vitest';
import {
  createDeclaredOpsRecipientsPort,
  normalizeOpsRecipientEmail,
  type OpsAccountLookupV1,
} from '../src/notifications/index.js';

const lookup = (records: Record<string, { status: 'active' | 'disabled'; email: string }>): OpsAccountLookupV1 => ({
  findAccount: async (accountId) => {
    const record = records[accountId];
    return record ? { accountStatus: record.status, email: record.email } : null;
  },
});

describe('declared ops recipients resolver', () => {
  it('resolves declared active accounts to live emails', async () => {
    const port = createDeclaredOpsRecipientsPort({
      declaration: { 'immo-prod': ['u-owner', 'u-farid'] },
      accounts: lookup({
        'u-owner': { status: 'active', email: 'Owner@Example.com ' },
        'u-farid': { status: 'active', email: 'farid@example.com' },
      }),
    });
    expect(await port.listRecipientsForTarget('immo-prod')).toEqual([
      { accountId: 'u-owner', email: 'owner@example.com', basis: 'platform-declaration:immo-prod' },
      { accountId: 'u-farid', email: 'farid@example.com', basis: 'platform-declaration:immo-prod' },
    ]);
  });

  it('returns empty for an unknown target so the host can fall back', async () => {
    const port = createDeclaredOpsRecipientsPort({ declaration: {}, accounts: lookup({}) });
    expect(await port.listRecipientsForTarget('nope')).toEqual([]);
  });

  it('skips unknown, inactive and invalid records and reports them', async () => {
    const onSkipped = vi.fn();
    const port = createDeclaredOpsRecipientsPort({
      declaration: { 'immo-prod': ['u-ok', 'u-ghost', 'u-off', 'u-bad', 'u-ok'] },
      accounts: lookup({
        'u-ok': { status: 'active', email: 'ok@example.com' },
        'u-off': { status: 'disabled', email: 'off@example.com' },
        'u-bad': { status: 'active', email: 'not-an-email' },
      }),
      onSkipped,
    });
    expect(await port.listRecipientsForTarget('immo-prod')).toEqual([
      { accountId: 'u-ok', email: 'ok@example.com', basis: 'platform-declaration:immo-prod' },
    ]);
    expect(onSkipped.mock.calls.map((call) => call[0])).toEqual([
      { targetKey: 'immo-prod', accountId: 'u-ghost', reason: 'unknown_account' },
      { targetKey: 'immo-prod', accountId: 'u-off', reason: 'account_not_active' },
      { targetKey: 'immo-prod', accountId: 'u-bad', reason: 'invalid_email' },
    ]);
  });

  it('normalizes and rejects stored addresses', () => {
    expect(normalizeOpsRecipientEmail('  Admin@Example.COM ')).toBe('admin@example.com');
    expect(normalizeOpsRecipientEmail('no-at-sign')).toBeNull();
    expect(normalizeOpsRecipientEmail('')).toBeNull();
    expect(normalizeOpsRecipientEmail(null)).toBeNull();
  });
});
