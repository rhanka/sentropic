// @sentropic/llm-mesh/node/cli/list-accounts.ts
//
// Strictly read-only `llm-mesh-enroll list`: discovers accountId and
// ownerScopeRef from `accounts:index`, `:public`, `:owner`, and `:removed`
// only. Never reads `:envelope`, never writes, works on `:ro` mounts.
// Output is one secret-free JSON line per active/reauth_required account.

import { isTombstoneBlocking } from './cloud-code-account-guard.js';
import { ACCOUNT_INDEX_KEY, parseAccountIndex } from './cloud-code-record.js';
import {
  defaultWriters,
  EXIT_CODES,
  fail,
  openKeyringForCli,
  type EnrollCliDeps,
  type ParsedArgs,
} from './enroll-args.js';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const cleanString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const durableOwner = (ownerRaw: string | null, accountId: string): string | undefined => {
  if (!ownerRaw) return undefined;
  try {
    const claim = JSON.parse(ownerRaw) as Record<string, unknown>;
    if (claim.v !== 1 || claim.accountId !== accountId) return undefined;
    return cleanString(claim.ownerScopeRef);
  } catch {
    return undefined;
  }
};

export const runList = async (
  args: ParsedArgs,
  deps: EnrollCliDeps = {},
): Promise<number> => {
  const writers = deps.writers ?? defaultWriters();
  const env = deps.env ?? process.env;
  if (args.missingValueFlags?.length) {
    return fail(writers, EXIT_CODES.usage, `flag '--${args.missingValueFlags[0]}' requires a non-empty value`);
  }
  if (!args.keyringDir) return fail(writers, EXIT_CODES.usage, 'missing --keyring-dir <dir>');
  // Provider-agnostic discovery: allow the local `.key` when no explicit
  // key env is named, exactly like the cloud-code CLI paths.
  const opened = openKeyringForCli('cloud-code', args.keyringDir, args.keyringKeyEnv, env);
  if (!opened.keyring) return fail(writers, EXIT_CODES.keyringKey, opened.error ?? 'keyring error');
  const { keyring } = opened;

  let indexRaw: string | null;
  try {
    indexRaw = await keyring.getSecret(ACCOUNT_INDEX_KEY);
  } catch {
    return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
  }
  const seen = new Set<string>();
  for (const accountId of parseAccountIndex(indexRaw)) {
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    let publicRaw: string | null;
    let ownerRaw: string | null;
    let removedRaw: string | null;
    try {
      [publicRaw, ownerRaw, removedRaw] = await Promise.all([
        keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`),
        keyring.getSecret(`sentropic-llm-mesh:${accountId}:owner`),
        keyring.getSecret(`sentropic-llm-mesh:${accountId}:removed`),
      ]);
    } catch {
      return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
    }
    if (!publicRaw) continue;
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(publicRaw) as unknown;
      if (!isPlainObject(parsed) || !isPlainObject(parsed.account)) continue;
      if (parsed.accountId !== accountId) continue;
      if (parsed.account.accountId !== undefined && parsed.account.accountId !== accountId) continue;
      record = parsed;
    } catch {
      continue;
    }
    const account = record.account as Record<string, unknown>;
    const providerId = cleanString(record.providerId);
    const status = cleanString(record.status) ?? cleanString(account.status);
    if (!providerId || (status !== 'active' && status !== 'reauth_required')) continue;
    if (isTombstoneBlocking(accountId, removedRaw, account.ownerScopeRef, record.removalBarrierRef)) continue;
    const ownerScopeRef = durableOwner(ownerRaw, accountId) ?? cleanString(account.ownerScopeRef);
    const metadata = isPlainObject(account.metadata) ? account.metadata : {};
    const project = cleanString(metadata.cloudaicompanionProject);
    const tier = cleanString(metadata.cloudCodeTier);
    const updatedAt = cleanString(record.updatedAt);
    writers.out(JSON.stringify({
      accountId,
      providerId,
      status,
      ...(ownerScopeRef ? { ownerScopeRef } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(project ? { project } : {}),
      ...(tier ? { tier } : {}),
    }));
  }
  return EXIT_CODES.ok;
};
