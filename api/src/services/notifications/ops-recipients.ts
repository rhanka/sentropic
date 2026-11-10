// Recipients binding for ops alerts (notify L1).
//
// v1 resolves through the validated platform declaration: each target maps
// to owning account ids, validated live against the identity store (must
// exist and be active; emails are read from the store, never hardcoded).
// The incident path is fail-closed: an unknown target, an empty declaration
// or all ids invalid yields an EMPTY list, and the sweep raises a
// configuration alert to the platform admins instead of rerouting the
// incident mail. The port stays so a later identity-tenant resolver can
// replace the declaration without touching the policy or the send path.

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
/** Identity lookups never block a sweep longer than this (M6: fail retryable). */
export const OPS_RECIPIENTS_LOOKUP_TIMEOUT_MS = 3000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const withTimeout = async <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`ops recipients lookup timed out (${label})`)), OPS_RECIPIENTS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Parse `OPS_JOB_FAILURE_TARGETS_JSON`; malformed input degrades to `{}` with an error log. */
export function parseOpsTargetsDeclaration(raw: string | undefined): Record<string, string[]> {
  if (!raw || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    logger.error('ops recipients declaration is not valid JSON; falling back to no declared targets');
    return {};
  }
  if (!isRecord(parsed)) {
    logger.error('ops recipients declaration must be an object; falling back to no declared targets');
    return {};
  }
  return normalizeDeclarationEntries(Object.entries(parsed));
}

/**
 * Strict variant for boot validation: malformed JSON, a non-object, or a
 * non-array entry is a startup failure (fail-closed), so a typoed operator
 * declaration cannot silently become "no admins".
 */
export function parseOpsTargetsDeclarationStrict(raw: string | undefined): Record<string, string[]> {
  if (!raw || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('ops recipients declaration is not valid JSON');
  }
  if (!isRecord(parsed)) throw new Error('ops recipients declaration must be an object');
  for (const [targetKey, accountIds] of Object.entries(parsed)) {
    if (!Array.isArray(accountIds)) {
      throw new Error(`ops recipients declaration entry ${JSON.stringify(targetKey)} must be an array`);
    }
  }
  return normalizeDeclarationEntries(Object.entries(parsed));
}

function normalizeDeclarationEntries(entries: [string, unknown][]): Record<string, string[]> {
  if (entries.length > MAX_TARGETS) {
    logger.warn(
      { targets: entries.length, kept: MAX_TARGETS },
      'ops recipients declaration truncated to the first targets',
    );
  }
  const declaration: Record<string, string[]> = {};
  for (const [targetKey, accountIds] of entries.slice(0, MAX_TARGETS)) {
    if (!Array.isArray(accountIds)) continue;
    const ids = accountIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length > MAX_ACCOUNTS_PER_TARGET) {
      logger.warn(
        { targetKey, accounts: ids.length, kept: MAX_ACCOUNTS_PER_TARGET },
        'ops recipients declaration truncated to the first accounts',
      );
    }
    const kept = ids.slice(0, MAX_ACCOUNTS_PER_TARGET);
    if (kept.length > 0) declaration[targetKey] = kept;
  }
  return declaration;
}

const identityAccountLookup = (): OpsAccountLookupV1 => ({
  findAccount: async (accountId: string) => withTimeout((async () => {
    const account = await getCmIdentity().core.accounts.findAccount(accountId);
    if (!account) return null;
    return { accountStatus: account.accountStatus, email: account.email };
  })(), `findAccount(${accountId})`),
});

/** Platform admins: transverse recipients for configuration alerts only. */
const listPlatformAdmins = async (): Promise<readonly { accountId: string; email: string; basis: string }[]> => {
  const accounts = await withTimeout(getCmIdentity().core.accounts.listAccounts(), 'listAccounts');
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

/**
 * v1 incident port: validated declaration only. Empty when the target has no
 * usable admin — the sweep then fails the delivery and raises the
 * configuration alert. Never falls back to platform admins here: incident
 * mail must not change audience.
 */
export function createOpsRecipientsPort(deps: OpsRecipientsBindingDeps = {}): OpsAlertRecipientsPortV1 {
  const declaration = deps.declaration ?? parseOpsTargetsDeclaration(env.OPS_JOB_FAILURE_TARGETS_JSON);
  const accounts = deps.accounts ?? identityAccountLookup();
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
      if (recipients.length === 0) {
        logger.warn({ targetKey }, 'ops alert target has no usable admin; failing closed with a configuration alert');
      }
      return recipients;
    },
  };
}

/** Configuration-alert port: transverse `admin_app` operators, no declaration. */
export function createOpsPlatformAdminsPort(
  deps: Pick<OpsRecipientsBindingDeps, 'platformAdmins'> = {},
): OpsAlertRecipientsPortV1 {
  const platformAdmins = deps.platformAdmins ?? listPlatformAdmins;
  return {
    async listRecipientsForTarget(targetKey: string) {
      try {
        return await withTimeout(platformAdmins(), 'platformAdmins');
      } catch (error) {
        logger.error(
          { targetKey, err: error instanceof Error ? error.message : 'unknown' },
          'ops platform admin lookup failed',
        );
        throw error;
      }
    },
  };
}
