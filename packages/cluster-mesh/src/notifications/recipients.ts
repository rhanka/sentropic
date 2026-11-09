// Recipients resolution for platform job-failure alerts (notify L1).
//
// The routing target is a PRODUCT key, not an identity tenant. v1 resolves
// through a validated platform declaration (target -> account ids); every
// declared id must exist and be active in the identity store, otherwise it is
// skipped and reported. Emails are never hardcoded: they are read live from
// the account records. The port stays so a later identity-tenant resolver
// (or the pull HTTP variant) can replace the declaration without touching
// the policy or the host send path.

import type { AccountStatus } from '../identity-contracts/types.js';

export interface OpsAlertRecipientV1 {
  readonly accountId: string;
  readonly email: string;
}

/**
 * Admins of target X. Empty means "no usable admin for this target": the
 * host falls back to the platform admins and raises a configuration alert.
 * Never rejects for an unknown target; silence is the failure this lot
 * removes.
 */
export interface OpsAlertRecipientsPortV1 {
  listRecipientsForTarget(targetKey: string): Promise<readonly OpsAlertRecipientV1[]>;
}

export interface OpsAccountRecordV1 {
  readonly accountStatus: AccountStatus;
  readonly email: string;
}

export interface OpsAccountLookupV1 {
  findAccount(accountId: string): Promise<OpsAccountRecordV1 | null>;
}

export type OpsRecipientSkipReason = 'unknown_account' | 'account_not_active' | 'invalid_email';

export interface OpsDeclaredRecipientsInputV1 {
  /** Platform declaration: product target key -> owning account ids. */
  readonly declaration: Readonly<Record<string, readonly string[]>>;
  readonly accounts: OpsAccountLookupV1;
  readonly onSkipped?: (info: {
    readonly targetKey: string;
    readonly accountId: string;
    readonly reason: OpsRecipientSkipReason;
  }) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Normalize a stored address; null when the stored value is not sendable. */
export function normalizeOpsRecipientEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 320) return null;
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

/**
 * v1 port implementation: validate the platform declaration against the
 * identity store on every resolution. Declared ids that are missing,
 * inactive or carry no sendable email are skipped (reported via onSkipped);
 * the caller decides the empty-result fallback.
 */
export function createDeclaredOpsRecipientsPort(input: OpsDeclaredRecipientsInputV1): OpsAlertRecipientsPortV1 {
  const { declaration, accounts, onSkipped } = input;
  return {
    async listRecipientsForTarget(targetKey: string): Promise<readonly OpsAlertRecipientV1[]> {
      const declared = declaration[targetKey];
      if (!declared) return [];
      const recipients: OpsAlertRecipientV1[] = [];
      const seen = new Set<string>();
      for (const accountId of declared) {
        const record = await accounts.findAccount(accountId);
        if (record === null) {
          onSkipped?.({ targetKey, accountId, reason: 'unknown_account' });
          continue;
        }
        if (record.accountStatus !== 'active') {
          onSkipped?.({ targetKey, accountId, reason: 'account_not_active' });
          continue;
        }
        const email = normalizeOpsRecipientEmail(record.email);
        if (email === null) {
          onSkipped?.({ targetKey, accountId, reason: 'invalid_email' });
          continue;
        }
        if (seen.has(email)) continue;
        seen.add(email);
        recipients.push({ accountId, email });
      }
      return recipients;
    },
  };
}
