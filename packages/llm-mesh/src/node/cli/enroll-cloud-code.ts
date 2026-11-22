// @sentropic/llm-mesh/node/cli/enroll-cloud-code.ts
//
// `llm-mesh-enroll enroll --provider cloud-code --from-agy [--account <id>] --keyring-dir <dir>`
// Imports the active agy OAuth login, verifies refresh + loadCodeAssist, and
// stores or re-activates the account in EncryptedFileKeyring without creating
// a new master key when updating an existing account. Secrets never leave
// memory or enter stdout/stderr/error messages.

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { CloudCodeEnrollmentProvider } from '../../enrollment/cloud-code.js';
import { AgyTokenReadError, readAgyOAuthCredential } from './agy-token-reader.js';
import {
  defaultWriters,
  EXIT_CODES,
  fail,
  openKeyringForCli,
  type EnrollCliDeps,
  type ParsedArgs,
} from './enroll-args.js';

const ACCOUNT_INDEX_KEY = 'sentropic-llm-mesh:accounts:index';

interface StoredPublicRecord {
  accountId: string;
  accountLabel?: string;
  providerId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  removalBarrierRef?: string;
  account?: Record<string, unknown>;
}

const sanitizeUpstreamStatus = (error: unknown): string => {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status
    ?? (error as { statusCode?: unknown })?.statusCode;
  if (typeof status === 'number') return ` (status ${status})`;
  const message = error instanceof Error ? error.message : '';
  const match = /\((\d{3})\)/.exec(message);
  return match ? ` (status ${match[1]})` : '';
};

const parseAccountIndex = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
};

export const runCloudCodeEnroll = async (
  args: ParsedArgs,
  deps: EnrollCliDeps = {},
): Promise<number> => {
  const writers = deps.writers ?? defaultWriters();
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;

  if (!args.fromAgy) {
    return fail(writers, EXIT_CODES.usage, 'cloud-code enrollment requires --from-agy');
  }
  if (!args.keyringDir) {
    return fail(writers, EXIT_CODES.usage, 'missing --keyring-dir <dir>');
  }

  const opened = openKeyringForCli('cloud-code', args.keyringDir, args.keyringKeyEnv, env);
  if (!opened.keyring) {
    return fail(writers, EXIT_CODES.keyringKey, opened.error ?? 'keyring error');
  }
  const { keyring } = opened;

  let existingPublic: StoredPublicRecord | null = null;
  let previousStatus: string | undefined;
  let ownerScope = args.ownerScope?.trim() || `cli:${hostname()}`;
  let accountId = args.account?.trim();

  if (accountId) {
    let rawPublic: string | null;
    try {
      rawPublic = await keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`);
    } catch {
      return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
    }
    if (!rawPublic) {
      return fail(writers, EXIT_CODES.accountNotFound, `account '${accountId}' not found`);
    }
    try {
      const parsed = JSON.parse(rawPublic) as Partial<StoredPublicRecord>;
      const transport = parsed.account?.transportProviderId;
      if (parsed.providerId !== 'cloud-code' || (transport !== undefined && transport !== 'cloud-code')) {
        return fail(writers, EXIT_CODES.accountNotFound, `account '${accountId}' is not a cloud-code account`);
      }
      existingPublic = parsed as StoredPublicRecord;
    } catch {
      return fail(writers, EXIT_CODES.enrollmentFailed, `account '${accountId}' public record is corrupt`);
    }
    const existingOwner = typeof existingPublic.account?.ownerScopeRef === 'string'
      ? existingPublic.account.ownerScopeRef
      : undefined;
    if (args.ownerScope?.trim() && existingOwner && args.ownerScope.trim() !== existingOwner) {
      return fail(writers, EXIT_CODES.usage, `owner-scope does not match existing account '${accountId}'`);
    }
    ownerScope = existingOwner ?? ownerScope;
    previousStatus = existingPublic.status;
  } else {
    accountId = `acct_cc_${Date.now().toString(36)}_${randomBytes(4).toString('hex').slice(0, 6)}`;
  }

  let agyCred;
  try {
    agyCred = await readAgyOAuthCredential({
      agyTokenFile: args.agyTokenFile,
      env,
      readRaw: deps.readAgyToken,
    });
  } catch (error) {
    const msg = error instanceof AgyTokenReadError ? error.message : 'failed to read agy credential';
    return fail(writers, EXIT_CODES.enrollmentFailed, msg);
  }

  const provider = new CloudCodeEnrollmentProvider({ fetchFn });
  let refreshed;
  try {
    refreshed = await provider.refresh({
      accountId,
      refreshToken: agyCred.refreshToken,
      credentialVersion: 'v1.0.0',
    });
  } catch (error) {
    return fail(
      writers,
      EXIT_CODES.enrollmentFailed,
      `cloud-code token refresh failed${sanitizeUpstreamStatus(error)}`,
    );
  }

  let metadata;
  try {
    metadata = await provider.resolve(refreshed);
  } catch (error) {
    return fail(
      writers,
      EXIT_CODES.enrollmentFailed,
      `cloud-code loadCodeAssist failed${sanitizeUpstreamStatus(error)}`,
    );
  }

  const now = new Date().toISOString();
  const label = args.label
    ?? existingPublic?.accountLabel
    ?? agyCred.email
    ?? (metadata.cloudaicompanionProject
      ? `Cloud Code (${metadata.cloudaicompanionProject})`
      : 'Cloud Code Account');

  const existingAccount = existingPublic?.account ?? {};
  const existingMeta = existingAccount.metadata && typeof existingAccount.metadata === 'object'
    ? (existingAccount.metadata as Record<string, unknown>)
    : {};

  const nextAccount = {
    ...existingAccount,
    accountId,
    ownerScopeRef: ownerScope,
    accountLabel: label,
    targetProviderId: 'gemini',
    transportProviderId: 'cloud-code',
    status: 'active',
    lastError: null,
    enrollmentCompletedAt: now,
    metadata: {
      ...existingMeta,
      ...metadata,
    },
  };

  const nextPublic: StoredPublicRecord = {
    ...(existingPublic ?? {}),
    accountId,
    accountLabel: label,
    providerId: 'cloud-code',
    status: 'active',
    createdAt: existingPublic?.createdAt ?? now,
    updatedAt: now,
    account: nextAccount,
  };

  const nextEnvelope = {
    accountId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    authClientConfigVersion: refreshed.authClientConfigVersion,
  };

  try {
    if (!existingPublic) {
      await keyring.setSecretIfAbsent(
        `sentropic-llm-mesh:${accountId}:owner`,
        JSON.stringify({ v: 1, accountId, ownerScopeRef: ownerScope }),
      );
    }
    await keyring.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify(nextEnvelope));
    await keyring.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify(nextPublic));
    const indexIds = parseAccountIndex(await keyring.getSecret(ACCOUNT_INDEX_KEY));
    if (!indexIds.includes(accountId)) {
      indexIds.push(accountId);
      await keyring.setSecret(ACCOUNT_INDEX_KEY, JSON.stringify(indexIds));
    }
  } catch {
    return fail(writers, EXIT_CODES.keyringKey, 'keyring write failed; check the key and permissions');
  }

  const project = typeof metadata.cloudaicompanionProject === 'string'
    ? metadata.cloudaicompanionProject
    : undefined;
  const tier = typeof metadata.cloudCodeTier === 'string'
    ? metadata.cloudCodeTier
    : undefined;

  writers.out(JSON.stringify({
    accountId,
    label,
    providerId: 'cloud-code',
    status: 'active',
    ...(previousStatus ? { previousStatus } : {}),
    expiresAt: refreshed.expiresAt,
    ...(project ? { project } : {}),
    ...(tier ? { tier } : {}),
  }));
  return EXIT_CODES.ok;
};
