// @sentropic/llm-mesh/node/cli/probe-cloud-code.ts
//
// Strictly read-only `probe --provider cloud-code`: verifies provider, status,
// and removal tombstone before touching any network endpoint, performs one
// minimal generate via GeminiAdapter/CloudCodeRuntimeClient, and prints status,
// latency, modelId, effort, and usage only. Never writes to the keyring.

import type { EncryptedFileKeyring } from '../keyring/encrypted-file-keyring.js';
import { isTombstoneBlocking } from './cloud-code-account-guard.js';
import { EXIT_CODES, fail, type CliWriters, type ParsedArgs } from './enroll-args.js';

export const probeCloudCode = async (
  args: ParsedArgs,
  effort: string,
  keyring: EncryptedFileKeyring,
  fetchFn: typeof fetch,
  writers: CliWriters,
): Promise<number> => {
  const accountId = args.account!.trim();
  let raw: string | null;
  let publicRaw: string | null;
  let removedRaw: string | null;
  try {
    [raw, publicRaw, removedRaw] = await Promise.all([
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:envelope`),
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`),
      keyring.getSecret(`sentropic-llm-mesh:${accountId}:removed`),
    ]);
  } catch {
    return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
  }
  if (!raw || !publicRaw) {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${accountId}' not found`);
  }
  let project = '';
  let accountStatus = '';
  try {
    const record = JSON.parse(publicRaw) as {
      accountId?: unknown;
      providerId?: unknown;
      status?: unknown;
      removalBarrierRef?: unknown;
      account?: {
        accountId?: unknown;
        status?: unknown;
        ownerScopeRef?: unknown;
        transportProviderId?: unknown;
        metadata?: { cloudaicompanionProject?: unknown };
      };
    };
    // Fail closed on swapped/miswritten records: never dispatch a token
    // whose stored records are not bound to the requested account.
    if (record.accountId !== accountId
      || (record.account?.accountId !== undefined && record.account.accountId !== accountId)) {
      return fail(writers, EXIT_CODES.probeFailed, `account '${accountId}' credential record is corrupt`);
    }
    if (record.providerId !== 'cloud-code' || (record.account?.transportProviderId !== undefined && record.account.transportProviderId !== 'cloud-code')) {
      throw new Error('bad provider');
    }
    if (isTombstoneBlocking(accountId, removedRaw, record.account?.ownerScopeRef, record.removalBarrierRef)) {
      return fail(writers, EXIT_CODES.accountNotFound, `account '${accountId}' has been removed`);
    }
    accountStatus = typeof record.status === 'string'
      ? record.status
      : typeof record.account?.status === 'string' ? record.account.status : '';
    const rawProject = record.account?.metadata?.cloudaicompanionProject;
    project = typeof rawProject === 'string' ? rawProject.trim() : '';
  } catch {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${accountId}' is not a cloud-code account`);
  }
  if (accountStatus === 'reauth_required' || accountStatus === 'disabled') {
    return fail(writers, EXIT_CODES.probeFailed, `account '${accountId}' status is '${accountStatus}'; re-enroll required`);
  }
  let accessToken: string;
  try {
    const envelope = JSON.parse(raw) as { accountId?: unknown; accessToken?: unknown };
    if (envelope.accountId !== accountId) throw new Error('bad binding');
    if (typeof envelope.accessToken !== 'string' || !envelope.accessToken) throw new Error('bad');
    accessToken = envelope.accessToken;
  } catch {
    return fail(writers, EXIT_CODES.probeFailed, `account '${accountId}' credential record is corrupt`);
  }
  if (!project) {
    return fail(writers, EXIT_CODES.probeFailed, `account '${accountId}' is missing cloudaicompanionProject metadata`);
  }
  let adapter: import('../../adapters.js').GeminiAdapter;
  try {
    const { GeminiAdapter } = await import('../../adapters.js');
    const { CloudCodeRuntimeClient } = await import('../../transport/cloud-code-runtime-client.js');
    adapter = new GeminiAdapter({ client: new CloudCodeRuntimeClient(fetchFn) });
  } catch {
    return fail(writers, EXIT_CODES.probeFailed, 'probe failed to load the cloud-code runtime');
  }
  const modelId = args.model ?? 'gemini-4-hydrogen';
  const startedAt = Date.now();
  try {
    const response = await adapter.generate(
      {
        providerId: 'gemini',
        modelId,
        messages: [{ role: 'user', content: 'probe' }],
        ...(effort !== 'none' ? { reasoning: { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } } : {}),
        maxOutputTokens: 16,
      },
      {
        auth: {
          material: {
            type: 'account-transport',
            provider: 'cloud-code',
            accessToken,
            accountId,
            metadata: { cloudaicompanionProject: project, leaseId: 'probe', stableSessionId: `probe_${accountId}` },
          },
          descriptor: { sourceType: 'account-transport', accountProviderId: 'cloud-code', accountId },
        },
      },
    );
    writers.out(JSON.stringify({
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      modelId: response.modelId,
      effort,
      ...(response.usage
        ? { usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens } }
        : {}),
    }));
    return EXIT_CODES.ok;
  } catch (error) {
    const status = (error as { status?: unknown; statusCode?: unknown })?.status
      ?? (error as { statusCode?: unknown })?.statusCode;
    if (typeof status === 'number') return fail(writers, EXIT_CODES.probeFailed, `probe failed (status ${status})`);
    const match = /\((\d{3})\)/.exec(error instanceof Error ? error.message : '');
    if (match) return fail(writers, EXIT_CODES.probeFailed, `probe failed (status ${match[1]})`);
    return fail(writers, EXIT_CODES.probeFailed, 'probe failed');
  }
};
