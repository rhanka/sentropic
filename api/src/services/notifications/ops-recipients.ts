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
  createCachedOpsRecipientsPort,
  createDeclaredOpsRecipientsPort,
  fetchOpsProductRecipients,
  normalizeOpsRecipientEmail,
  type OpsAccountLookupV1,
  type OpsAlertRecipientsPortV1,
  type OpsFetchLike,
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
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error('ops recipients declaration must be an object');
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
  /** Optional product pull URLs: target -> recipientsUrl (conductor contract v1). */
  readonly recipientsUrls?: Record<string, string>;
  readonly fetchFn?: OpsFetchLike;
  readonly now?: () => string;
}

/**
 * A product recipients URL is `https` (any host, no credentials) or plain
 * `http` loopback only (`localhost`, `127.0.0.1`, `::1`, no credentials).
 * Prefix matching is banned: `localhost.evil` and `localhost@evil` are
 * rejected by hostname comparison, not by `startsWith`.
 */
export function isAllowedOpsRecipientsUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;
  if (parsed.protocol === 'https:') return parsed.hostname.length > 0;
  if (parsed.protocol === 'http:') {
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  }
  return false;
}

/** Parse `OPS_JOB_FAILURE_RECIPIENTS_URLS_JSON` (target -> recipientsUrl). */
export function parseOpsRecipientsUrls(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    logger.error('ops recipients urls are not valid JSON; product pull disabled');
    return {};
  }
  if (!isRecord(parsed)) {
    logger.error('ops recipients urls must be an object; product pull disabled');
    return {};
  }
  const urls: Record<string, string> = {};
  for (const [targetKey, url] of Object.entries(parsed)) {
    if (typeof url !== 'string' || !isAllowedOpsRecipientsUrl(url)) continue;
    urls[targetKey] = url;
  }
  return urls;
}

/** Strict variant for boot validation: a typoed URL is a startup failure. */
export function parseOpsRecipientsUrlsStrict(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('ops recipients urls are not valid JSON');
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error('ops recipients urls must be an object');
  const urls: Record<string, string> = {};
  for (const [targetKey, url] of Object.entries(parsed)) {
    if (typeof url !== 'string' || !isAllowedOpsRecipientsUrl(url)) {
      throw new Error(`ops recipients url for ${JSON.stringify(targetKey)} is not an allowed https/loopback URL`);
    }
    urls[targetKey] = url;
  }
  return urls;
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
  // Optional product pull (conductor contract v1): targets with a configured
  // recipientsUrl resolve through the validated product answer (cached
  // 10 min, stale-while-error 24 h); every other target uses the declaration.
  const urls = deps.recipientsUrls ?? parseOpsRecipientsUrls(env.OPS_JOB_FAILURE_RECIPIENTS_URLS_JSON);
  const now = deps.now ?? (() => new Date().toISOString());
  const bearer = env.OPS_JOB_FAILURE_RECIPIENTS_BEARER;
  const fetchFn: OpsFetchLike = deps.fetchFn ?? ((url, init) =>
    fetch(url, {
      signal: init.signal,
      ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
    }));

  const byTarget = new Map<string, OpsAlertRecipientsPortV1>();
  const pullFor = (targetKey: string): OpsAlertRecipientsPortV1 => {
    const cached = byTarget.get(targetKey);
    if (cached) return cached;
    const port = createCachedOpsRecipientsPort({
      now,
      onError: ({ code }) => logger.warn({ targetKey, code }, 'ops product recipients pull failed'),
      load: async (key) => {
        if (key !== targetKey) throw new Error('ops recipients pull target mismatch');
        return fetchOpsProductRecipients({ url: urls[key]!, targetKey: key, fetchFn, nowIso: now() });
      },
    });
    byTarget.set(targetKey, port);
    return port;
  };
  return {
    async listRecipientsForTarget(targetKey: string) {
      if (urls[targetKey]) {
        const recipients = await pullFor(targetKey).listRecipientsForTarget(targetKey);
        if (recipients.length === 0) {
          logger.warn({ targetKey }, 'ops product answered no admin; failing closed with a configuration alert');
        }
        return recipients;
      }
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
