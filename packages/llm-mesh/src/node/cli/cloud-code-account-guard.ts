// @sentropic/llm-mesh/node/cli/cloud-code-account-guard.ts
//
// Read-only pre-flight checks and account isolation invariants for
// `llm-mesh-enroll enroll --provider cloud-code`.

import { readdir } from 'node:fs/promises';
import { isExternalSeatAccount } from '../../service/external-seat-authority.js';
import type { EncryptedFileKeyring } from '../keyring/encrypted-file-keyring.js';
import type { StoredPublicRecord } from './cloud-code-record.js';
import { EXIT_CODES } from './enroll-args.js';

export interface ExistingAccountSnapshot {
  publicRaw: string;
  envelopeRaw: string | null;
  ownerRaw: string | null;
  removedRaw: string | null;
}

export interface LoadedExistingAccount {
  publicRecord: StoredPublicRecord;
  ownerScope: string;
  previousStatus: string;
  snapshot: ExistingAccountSnapshot;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isEnoent = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';

/** Refuse creating a `.key` file next to existing encrypted records lacking one. */
export const assertNoMissingKeyForExistingKeyring = async (
  keyringDir: string,
  hasExplicitKey: boolean,
): Promise<string | null> => {
  if (hasExplicitKey) return null;
  let entries: string[];
  try {
    entries = await readdir(keyringDir);
  } catch (error) {
    if (isEnoent(error)) return null;
    return 'keyring directory could not be inspected; check permissions';
  }
  if (!entries.includes('.key') && entries.some((entry) => entry.endsWith('.json'))) {
    return 'keyring directory holds encrypted records without .key; pass --keyring-key-env <NAME>';
  }
  return null;
};

export const isTombstoneBlocking = (
  accountId: string,
  removedRaw: string | null,
  ownerScopeRef: unknown,
  removalBarrierRef: unknown,
): boolean => {
  if (removedRaw === null) return false;
  try {
    const t = JSON.parse(removedRaw) as Record<string, unknown>;
    if (t.v !== 1 || t.accountId !== accountId || typeof t.ownerScopeRef !== 'string'
      || !t.ownerScopeRef || typeof t.removedAt !== 'string') return true;
    return ownerScopeRef !== t.ownerScopeRef || removalBarrierRef !== t.removedAt;
  } catch {
    return true;
  }
};

export const loadExistingCloudCodeAccount = async (
  keyring: EncryptedFileKeyring,
  accountId: string,
  expectedOwnerScope: string,
): Promise<{ loaded?: LoadedExistingAccount; errorCode?: number; error?: string }> => {
  let publicRaw: string | null;
  let envelopeRaw: string | null;
  let ownerRaw: string | null;
  let removedRaw: string | null;
  let seatRaw: string | null;
  try {
    [publicRaw, envelopeRaw, ownerRaw, removedRaw, seatRaw] = await Promise.all([
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`),
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:envelope`),
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:owner`),
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:removed`),
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:seat-record`),
    ]);
  } catch {
    return { errorCode: EXIT_CODES.keyringKey, error: 'keyring read failed; check the key and permissions' };
  }
  if (!publicRaw) return { errorCode: EXIT_CODES.accountNotFound, error: `account '${accountId}' not found` };
  let parsed: Record<string, unknown>;
  try {
    const val = JSON.parse(publicRaw) as unknown;
    if (!isPlainObject(val) || !isPlainObject(val.account) || val.accountId !== accountId) throw new Error('bad');
    if (val.account.accountId !== undefined && val.account.accountId !== accountId) throw new Error('bad');
    parsed = val;
  } catch {
    return { errorCode: EXIT_CODES.enrollmentFailed, error: `account '${accountId}' public record is corrupt` };
  }
  const account = parsed.account as Record<string, unknown>;
  const target = account.targetProviderId;
  if (parsed.providerId !== 'cloud-code' || account.transportProviderId !== 'cloud-code'
    || (target !== 'gemini' && target !== 'google')) {
    return { errorCode: EXIT_CODES.accountNotFound, error: `account '${accountId}' is not a cloud-code account` };
  }
  const meta = isPlainObject(account.metadata) ? account.metadata : undefined;
  if (accountId.startsWith('seat-') || seatRaw !== null || isExternalSeatAccount({ accountId, metadata: meta })) {
    return { errorCode: EXIT_CODES.enrollmentFailed, error: `account '${accountId}' is an externally custodied seat` };
  }
  if (isTombstoneBlocking(accountId, removedRaw, account.ownerScopeRef, parsed.removalBarrierRef)) {
    return { errorCode: EXIT_CODES.accountNotFound, error: `account '${accountId}' has been removed` };
  }
  let claimOwner: string | undefined;
  if (ownerRaw !== null) {
    try {
      const claim = JSON.parse(ownerRaw) as Record<string, unknown>;
      if (claim.v !== 1 || claim.accountId !== accountId || typeof claim.ownerScopeRef !== 'string' || !claim.ownerScopeRef.trim()) {
        throw new Error('bad');
      }
      claimOwner = claim.ownerScopeRef.trim();
    } catch {
      return { errorCode: EXIT_CODES.enrollmentFailed, error: `account '${accountId}' owner claim is corrupt` };
    }
  }
  const publicOwner = typeof account.ownerScopeRef === 'string' && account.ownerScopeRef.trim() ? account.ownerScopeRef.trim() : undefined;
  if (claimOwner && publicOwner && claimOwner !== publicOwner) {
    return { errorCode: EXIT_CODES.enrollmentFailed, error: `account '${accountId}' belongs to another owner scope` };
  }
  const accountOwner = claimOwner ?? publicOwner;
  if (!accountOwner) return { errorCode: EXIT_CODES.enrollmentFailed, error: `account '${accountId}' has no owner scope` };
  if (expectedOwnerScope !== accountOwner) {
    return { errorCode: EXIT_CODES.usage, error: `owner-scope does not match existing account '${accountId}'` };
  }
  return {
    loaded: {
      publicRecord: parsed as unknown as StoredPublicRecord,
      ownerScope: accountOwner,
      previousStatus: typeof parsed.status === 'string' ? parsed.status : 'unknown',
      snapshot: { publicRaw, envelopeRaw, ownerRaw, removedRaw },
    },
  };
};
