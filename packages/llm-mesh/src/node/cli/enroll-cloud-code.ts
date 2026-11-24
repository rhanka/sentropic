// @sentropic/llm-mesh/node/cli/enroll-cloud-code.ts
//
// `llm-mesh-enroll enroll --provider cloud-code (--from-agy | --credential-stdin | --oauth-paste)`
// Requires an explicit existing `--account <id>` by default (`--create-account`
// + `--owner-scope <ref>` for a new account). Commits with a single CAS over
// :envelope, :public, :owner (when created), and accounts:index, so neither
// CLI enroll nor custodian refresh clobbers the other and any abort leaves
// the keyring byte-identical.

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { CloudCodeEnrollmentProvider } from '../../enrollment/cloud-code.js';
import { AgyTokenReadError, readCloudCodeCredential } from './agy-token-reader.js';
import {
  assertNoMissingKeyForExistingKeyring,
  loadExistingCloudCodeAccount,
  type LoadedExistingAccount,
} from './cloud-code-account-guard.js';
import {
  ACCOUNT_INDEX_KEY,
  buildAllowlistedPublicRecord,
  ownerClaimJson,
  parseAccountIndex,
  sanitizeUpstreamStatus,
} from './cloud-code-record.js';
import { readPastedOAuthCallback } from './oauth-paste.js';
import {
  defaultWriters,
  EXIT_CODES,
  fail,
  openKeyringForCli,
  type EnrollCliDeps,
  type ParsedArgs,
} from './enroll-args.js';

const OAUTH_PASTE_REDIRECT_URI = 'http://127.0.0.1:1/oauth/callback';

const validateArgs = (args: ParsedArgs): string | null => {
  if (args.missingValueFlags?.length) return `flag '--${args.missingValueFlags[0]}' requires a non-empty value`;
  const sources = [args.fromAgy, args.credentialStdin, args.oauthPaste].filter(Boolean).length;
  if (sources > 1) return 'pass exactly one of --from-agy, --credential-stdin, or --oauth-paste';
  if (sources === 0) return 'cloud-code enrollment requires --from-agy, --credential-stdin, or --oauth-paste';
  if (!args.keyringDir) return 'missing --keyring-dir <dir>';
  if (args.createAccount && args.account !== undefined) return '--create-account cannot be combined with --account';
  if (args.createAccount && !args.ownerScope?.trim()) return '--create-account requires --owner-scope <ref>';
  if (!args.createAccount && !args.account?.trim()) {
    return 'missing --account <id>; pass --create-account to create a new account';
  }
  return null;
};

export const runCloudCodeEnroll = async (
  args: ParsedArgs,
  deps: EnrollCliDeps = {},
): Promise<number> => {
  const writers = deps.writers ?? defaultWriters();
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;

  const usageError = validateArgs(args);
  if (usageError) return fail(writers, EXIT_CODES.usage, usageError);

  const keyGuardError = await assertNoMissingKeyForExistingKeyring(args.keyringDir!, args.keyringKeyEnv !== undefined);
  if (keyGuardError) return fail(writers, EXIT_CODES.keyringKey, keyGuardError);

  const opened = openKeyringForCli('cloud-code', args.keyringDir!, args.keyringKeyEnv, env);
  if (!opened.keyring) return fail(writers, EXIT_CODES.keyringKey, opened.error ?? 'keyring error');
  const { keyring } = opened;

  let existing: LoadedExistingAccount | null = null;
  let accountId: string;
  let ownerScope: string;
  let indexRaw: string | null;

  if (args.createAccount) {
    try { indexRaw = await keyring.getSecret(ACCOUNT_INDEX_KEY); } catch {
      return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
    }
    accountId = `acct_cc_${Date.now().toString(36)}_${randomBytes(4).toString('hex').slice(0, 6)}`;
    ownerScope = args.ownerScope!.trim();
  } else {
    accountId = args.account!.trim();
    const expectedOwner = args.ownerScope?.trim() || `cli:${deps.hostname ?? hostname()}`;
    const loaded = await loadExistingCloudCodeAccount(keyring, accountId, expectedOwner);
    if (!loaded.loaded) {
      return fail(writers, loaded.errorCode ?? EXIT_CODES.enrollmentFailed, loaded.error ?? 'account validation failed');
    }
    existing = loaded.loaded;
    ownerScope = existing.ownerScope;
    try { indexRaw = await keyring.getSecret(ACCOUNT_INDEX_KEY); } catch {
      return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
    }
  }

  const provider = new CloudCodeEnrollmentProvider({ fetchFn });
  let refreshed: {
    accountId: string; accessToken: string; refreshToken: string;
    expiresAt: string; authClientConfigVersion: string;
  };
  if (args.oauthPaste) {
    // Dedicated grant minted in place: read-only preflight above has
    // already passed and no keyring lock is held while the operator
    // completes browser consent.
    let session;
    try {
      session = await provider.start({
        configRef: 'default', mode: 'portal', redirectUri: OAUTH_PASTE_REDIRECT_URI, ownerScope,
      });
    } catch {
      return fail(writers, EXIT_CODES.enrollmentFailed, 'cloud-code OAuth session start failed');
    }
    if (session.kind !== 'authorization-url') {
      return fail(writers, EXIT_CODES.enrollmentFailed, 'cloud-code OAuth session start failed');
    }
    writers.out(JSON.stringify({ authorizationUrl: session.url, expiresAt: session.expiresAt }));
    let pasted;
    try {
      pasted = await readPastedOAuthCallback(deps.stdin, deps.oauthPasteTimeoutMs);
    } catch (error) {
      return fail(writers, EXIT_CODES.enrollmentFailed, error instanceof AgyTokenReadError ? error.message : 'failed to read pasted OAuth callback');
    }
    let minted;
    try {
      minted = await provider.complete({ enrollmentId: session.enrollmentId, code: pasted.code, state: pasted.state });
    } catch (error) {
      return fail(writers, EXIT_CODES.enrollmentFailed, `cloud-code token exchange failed${sanitizeUpstreamStatus(error)}`);
    }
    if (!minted.refreshToken) {
      return fail(writers, EXIT_CODES.enrollmentFailed, 'cloud-code token exchange returned no refresh token; retry the consent flow');
    }
    refreshed = {
      accountId, accessToken: minted.accessToken, refreshToken: minted.refreshToken,
      expiresAt: minted.expiresAt, authClientConfigVersion: minted.authClientConfigVersion,
    };
  } else {
    let cred;
    try {
      cred = await readCloudCodeCredential({
        source: args.credentialStdin ? 'credential-stdin' : 'from-agy',
        env, stdin: deps.stdin, secretToolPath: deps.secretToolPath,
        secretToolTimeoutMs: deps.secretToolTimeoutMs, readRaw: deps.readAgyToken,
      });
    } catch (error) {
      return fail(writers, EXIT_CODES.enrollmentFailed, error instanceof AgyTokenReadError ? error.message : 'failed to read credential');
    }
    let exchanged;
    try {
      exchanged = await provider.refresh({ accountId, refreshToken: cred.refreshToken, credentialVersion: 'v1.0.0' });
    } catch (error) {
      return fail(writers, EXIT_CODES.enrollmentFailed, `cloud-code token refresh failed${sanitizeUpstreamStatus(error)}`);
    }
    if (!exchanged.refreshToken) {
      return fail(writers, EXIT_CODES.enrollmentFailed, 'cloud-code token refresh returned no refresh token');
    }
    refreshed = { ...exchanged, refreshToken: exchanged.refreshToken };
  }
  let metadata;
  try { metadata = await provider.resolve(refreshed); } catch (error) {
    return fail(writers, EXIT_CODES.enrollmentFailed, `cloud-code loadCodeAssist failed${sanitizeUpstreamStatus(error)}`);
  }

  const now = new Date().toISOString();
  const built = buildAllowlistedPublicRecord({
    accountId, ownerScope, explicitLabel: args.label, existingPublic: existing?.publicRecord ?? null, metadata, now,
  });
  const nextEnvelope = JSON.stringify({
    accountId, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt, authClientConfigVersion: refreshed.authClientConfigVersion,
  });
  const nextPublic = JSON.stringify(built.publicRecord);

  try {
    // One atomic transaction: :owner creation and the index append ride
    // the same CAS as :envelope/:public, so any abort or write error
    // rolls every record back byte-identically.
    const updates: { key: string; expected: string | null; secret: string }[] = [
      { key: `sentropic-llm-mesh:${accountId}:envelope`, expected: existing?.snapshot.envelopeRaw ?? null, secret: nextEnvelope },
      { key: `sentropic-llm-mesh:${accountId}:public`, expected: existing?.snapshot.publicRaw ?? null, secret: nextPublic },
    ];
    const guards: { key: string; expected: string | null }[] = [
      { key: `sentropic-llm-mesh:${accountId}:removed`, expected: existing?.snapshot.removedRaw ?? null },
    ];
    if (existing?.snapshot.ownerRaw != null) {
      guards.push({ key: `sentropic-llm-mesh:${accountId}:owner`, expected: existing.snapshot.ownerRaw });
    } else {
      updates.push({
        key: `sentropic-llm-mesh:${accountId}:owner`, expected: null,
        secret: ownerClaimJson(accountId, ownerScope),
      });
    }
    const indexIds = parseAccountIndex(indexRaw);
    if (!indexIds.includes(accountId)) {
      updates.push({ key: ACCOUNT_INDEX_KEY, expected: indexRaw, secret: JSON.stringify([...indexIds, accountId]) });
    }
    const committed = await keyring.compareAndSetSecrets(updates, guards);
    if (!committed) return fail(writers, EXIT_CODES.enrollmentFailed, `account '${accountId}' was modified concurrently; retry`);
  } catch {
    return fail(writers, EXIT_CODES.keyringKey, 'keyring write failed; check the key and permissions');
  }

  writers.out(JSON.stringify({
    accountId, label: built.label, providerId: 'cloud-code', status: 'active',
    ...(existing?.previousStatus ? { previousStatus: existing.previousStatus } : {}),
    expiresAt: refreshed.expiresAt,
    ...(built.project ? { project: built.project } : {}),
    ...(built.tier ? { tier: built.tier } : {}),
  }));
  return EXIT_CODES.ok;
};
