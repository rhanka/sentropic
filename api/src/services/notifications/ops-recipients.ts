// Recipients binding for ops alerts (notify L1).
//
// v1 resolves through the validated platform declaration: each target maps
// to owning account ids, validated live against the identity store (must
// exist and be active; emails are read from the store, never hardcoded).
// Empty resolution (unknown target, empty declaration, all ids invalid)
// falls back to the platform admins (`admin_app`) plus a configuration
// alert log — an alert never dies silently. The port stays so a later
// identity-tenant resolver can replace the declaration without touching
// the policy or the send path.

import {
  createDeclaredOpsRecipientsPort,
  normalizeOpsRecipientEmail,
  type OpsAccountLookupV1,
  type OpsAlertRecipientsPortV1,
} from '@sentropic/cluster-mesh/notifications';
import { env } from '../../config/env';
import { logger } from '../../logger';
import { getCmIdentity } from '../identity/cm-identity';

const MAX_TARGETS = 50;
const MAX_ACCOUNTS_PER_TARGET = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Parse `OPS_JOB_FAILURE_TARGETS_JSON`; malformed input degrades to `{}` with an error log. */
export function parseOpsTargetsDeclaration(raw: string | undefined): Record<string, string[]> {
  if (!raw || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    logger.error('ops recipients declaration is not valid JSON; falling back to platform admins');
    return {};
  }
  if (!isRecord(parsed)) {
    logger.error('ops recipients declaration must be an object; falling back to platform admins');
    return {};
  }
  const entries = Object.entries(parsed).slice(0, MAX_TARGETS);
  const declaration: Record<string, string[]> = {};
  for (const [targetKey, accountIds] of entries) {
    if (!Array.isArray(accountIds)) continue;
    const ids = accountIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, MAX_ACCOUNTS_PER_TARGET);
    if (ids.length > 0) declaration[targetKey] = ids;
  }
  return declaration;
}

const identityAccountLookup = (): OpsAccountLookupV1 => ({
  findAccount: async (accountId: string) => {
    const account = await getCmIdentity().core.accounts.findAccount(accountId);
    if (!account) return null;
    return { accountStatus: account.accountStatus, email: account.email };
  },
});

/** Platform admins: transverse fallback when a target has no usable admin. */
const listPlatformAdmins = async (): Promise<readonly { accountId: string; email: string; basis: string }[]> => {
  const accounts = await getCmIdentity().core.accounts.listAccounts();
  const seen = new Set<string>();
  const admins: { accountId: string; email: string; basis: string }[] = [];
  for (const account of accounts) {
    if (account.globalRole !== 'admin_app' || account.accountStatus !== 'active') continue;
    // Same sendability gate as declared accounts: an invalid stored platform
    // address fails this delivery instead of failing the whole send.
    const email = normalizeOpsRecipientEmail(account.email);
    if (email === null) {
      logger.warn({ accountId: account.userId }, 'ops platform admin address not sendable, skipped');
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    admins.push({ accountId: account.userId, email, basis: 'platform-admin-fallback' });
  }
  return admins;
};

export interface OpsRecipientsBindingDeps {
  readonly declaration?: Record<string, string[]>;
  readonly accounts?: OpsAccountLookupV1;
  readonly platformAdmins?: () => Promise<readonly { accountId: string; email: string; basis: string }[]>;
}

/** v1 port: validated declaration first, platform-admin fallback otherwise. */
export function createOpsRecipientsPort(deps: OpsRecipientsBindingDeps = {}): OpsAlertRecipientsPortV1 {
  const declaration = deps.declaration ?? parseOpsTargetsDeclaration(env.OPS_JOB_FAILURE_TARGETS_JSON);
  const accounts = deps.accounts ?? identityAccountLookup();
  const platformAdmins = deps.platformAdmins ?? listPlatformAdmins;
  const declared = createDeclaredOpsRecipientsPort({
    declaration,
    accounts,
    onSkipped: ({ targetKey, accountId, reason }) => {
      logger.warn({ targetKey, accountId, reason }, 'ops recipients declaration entry skipped');
    },
  });
  return {
    async listRecipientsForTarget(targetKey: string) {
      const recipients = await declared.listRecipientsForTarget(targetKey);
      if (recipients.length > 0) return recipients;
      logger.warn({ targetKey }, 'ops alert target has no usable admin; falling back to platform admins');
      return platformAdmins();
    },
  };
}
