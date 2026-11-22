// @sentropic/llm-mesh/node/cli/enroll-cli.ts
//
// Generic device-flow enrollment CLI (muse-code first):
// `enroll` stores a seat account, `probe` checks it with one minimal
// generate through MuseAdapter/MuseRuntimeClient. stdout is a machine
// contract (one JSON object per line); secrets never printed.

import {
  defaultWriters,
  EXIT_CODES,
  fail,
  openKeyringForCli,
  parseArgs,
  usageText,
  type EnrollCliDeps,
  type ParsedArgs,
} from './enroll-args.js';
import { runEnroll } from './enroll-command.js';

const KNOWN_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

const probeCloudCode = async (
  args: ParsedArgs,
  effort: string,
  keyring: import('../keyring/encrypted-file-keyring.js').EncryptedFileKeyring,
  fetchFn: typeof fetch,
  writers: import('./enroll-args.js').CliWriters,
): Promise<number> => {
  let raw: string | null;
  let publicRaw: string | null;
  try {
    raw = await keyring.getSecret(`sentropic-llm-mesh:${args.account}:envelope`);
    publicRaw = await keyring.getSecret(`sentropic-llm-mesh:${args.account}:public`);
  } catch {
    return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
  }
  if (!raw) {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${args.account}' not found`);
  }
  let project = '';
  let accountStatus = '';
  try {
    const record = JSON.parse(publicRaw ?? '') as {
      providerId?: unknown;
      status?: unknown;
      account?: { status?: unknown; metadata?: { cloudaicompanionProject?: unknown } };
    };
    if (record.providerId !== 'cloud-code') throw new Error('bad provider');
    accountStatus = typeof record.status === 'string'
      ? record.status
      : typeof record.account?.status === 'string'
        ? record.account.status
        : '';
    const rawProject = record.account?.metadata?.cloudaicompanionProject;
    project = typeof rawProject === 'string' ? rawProject.trim() : '';
  } catch {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${args.account}' is not a cloud-code account`);
  }
  if (accountStatus === 'reauth_required' || accountStatus === 'disabled') {
    return fail(writers, EXIT_CODES.probeFailed, `account '${args.account}' status is '${accountStatus}'; re-enroll required`);
  }
  let accessToken: string;
  try {
    const envelope = JSON.parse(raw) as { accessToken?: unknown };
    if (typeof envelope.accessToken !== 'string' || !envelope.accessToken) throw new Error('bad');
    accessToken = envelope.accessToken;
  } catch {
    return fail(writers, EXIT_CODES.probeFailed, `account '${args.account}' credential record is corrupt`);
  }
  if (!project) {
    return fail(writers, EXIT_CODES.probeFailed, `account '${args.account}' is missing cloudaicompanionProject metadata`);
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
            accountId: args.account,
            metadata: {
              cloudaicompanionProject: project,
              leaseId: 'probe',
              stableSessionId: `probe_${args.account}`,
            },
          },
          descriptor: {
            sourceType: 'account-transport',
            accountProviderId: 'cloud-code',
            accountId: args.account,
          },
        },
      },
    );
    writers.out(JSON.stringify({
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      modelId: response.modelId,
      effort,
      ...(response.usage
        ? {
            usage: {
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              totalTokens: response.usage.totalTokens,
            },
          }
        : {}),
    }));
    return EXIT_CODES.ok;
  } catch (error) {
    const status = (error as { status?: unknown; statusCode?: unknown })?.status
      ?? (error as { statusCode?: unknown })?.statusCode;
    if (typeof status === 'number') {
      return fail(writers, EXIT_CODES.probeFailed, `probe failed (status ${status})`);
    }
    const msg = error instanceof Error ? error.message : '';
    const match = /\((\d{3})\)/.exec(msg);
    if (match) {
      return fail(writers, EXIT_CODES.probeFailed, `probe failed (status ${match[1]})`);
    }
    return fail(writers, EXIT_CODES.probeFailed, 'probe failed');
  }
};

export const runProbe = async (
  args: ParsedArgs,
  deps: EnrollCliDeps = {},
): Promise<number> => {
  const writers = deps.writers ?? defaultWriters();
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  if (args.provider !== 'muse-code' && args.provider !== 'cloud-code') {
    return fail(writers, EXIT_CODES.usage, `provider '${args.provider}' has no probe; expected 'muse-code' or 'cloud-code'`);
  }
  if (!args.keyringDir) return fail(writers, EXIT_CODES.usage, 'missing --keyring-dir <dir>');
  if (!args.account) return fail(writers, EXIT_CODES.usage, 'missing --account <id>');
  const effort = args.effort ?? 'low';
  if (!KNOWN_EFFORTS.has(effort)) {
    return fail(writers, EXIT_CODES.usage, `unknown --effort '${effort}'`);
  }
  const opened = openKeyringForCli(args.provider, args.keyringDir, args.keyringKeyEnv, env);
  if (!opened.keyring) return fail(writers, EXIT_CODES.keyringKey, opened.error ?? 'key error');
  const { keyring } = opened;
  if (args.provider === 'cloud-code') {
    return probeCloudCode(args, effort, keyring, fetchFn, writers);
  }
  let raw: string | null;
  let publicRaw: string | null;
  try {
    raw = await keyring.getSecret(`sentropic-llm-mesh:${args.account}:envelope`);
    publicRaw = await keyring.getSecret(`sentropic-llm-mesh:${args.account}:public`);
  } catch {
    return fail(writers, EXIT_CODES.keyringKey, 'keyring read failed; check the key and permissions');
  }
  if (!raw) {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${args.account}' not found`);
  }
  // The envelope carries no provider; the public record does. Refuse any
  // non-muse account before any token leaves the keyring: a codex OAuth
  // token must never reach api.meta.ai.
  try {
    const record = JSON.parse(publicRaw ?? '') as { providerId?: unknown };
    if (record.providerId !== 'muse') throw new Error('bad provider');
  } catch {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${args.account}' is not a muse-code seat account`);
  }
  let accessToken: string;
  try {
    const envelope = JSON.parse(raw) as { accessToken?: unknown };
    if (typeof envelope.accessToken !== 'string' || !envelope.accessToken) throw new Error('bad');
    accessToken = envelope.accessToken;
  } catch {
    return fail(writers, EXIT_CODES.probeFailed, `account '${args.account}' credential record is corrupt`);
  }
  // The Muse Chat wire takes no reasoning controls (the client refuses a
  // non-empty reasoning block), so --effort is validated for forward
  // compatibility but not forwarded.
  let adapter: import('../../adapters.js').MuseAdapter;
  try {
    const { MuseAdapter } = await import('../../adapters.js');
    const { MuseRuntimeClient } = await import('../../transport/muse-runtime-client.js');
    adapter = new MuseAdapter({ client: new MuseRuntimeClient({ fetch: fetchFn }) });
  } catch {
    return fail(writers, EXIT_CODES.probeFailed, 'probe failed to load the muse runtime');
  }
  const modelId = args.model ?? 'muse-wonder-1.0';
  const startedAt = Date.now();
  try {
    const response = await adapter.generate(
      { providerId: 'muse', modelId, messages: [{ role: 'user', content: 'probe' }], maxOutputTokens: 16 },
      {
        auth: {
          material: { type: 'account-transport', provider: 'muse', accessToken, accountId: args.account },
          descriptor: { sourceType: 'account-transport', accountProviderId: 'muse' },
        },
      },
    );
    // Status plus latency plus usage only; the model text stays out.
    writers.out(JSON.stringify({
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      modelId: response.modelId,
      ...(response.usage ? { usage: response.usage } : {}),
    }));
    return EXIT_CODES.ok;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (status === 402) {
      // Measured non-seat wire: a raw MUSE_API_KEY import (muse.ts direct
      // path) is not seat-billed, so serving refuses billing_not_configured.
      // Seat-billed device-flow accounts (muse-code.ts) never hit this.
      return fail(writers, EXIT_CODES.billingNotConfigured,
        'billing_not_configured: non-seat muse.ts direct-key path; re-enroll a seat account');
    }
    if (typeof status === 'number') {
      return fail(writers, EXIT_CODES.probeFailed, `probe failed (status ${status})`);
    }
    return fail(writers, EXIT_CODES.probeFailed, 'probe failed');
  }
};

export const run = async (argv: string[], deps: EnrollCliDeps = {}): Promise<number> => {
  const writers = deps.writers ?? defaultWriters();
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return fail(writers, EXIT_CODES.usage, error instanceof Error ? error.message : 'bad usage');
  }
  if (args.command === 'help') {
    writers.out(usageText());
    return EXIT_CODES.ok;
  }
  if (args.command === 'enroll') return runEnroll(args, deps);
  return runProbe(args, deps);
};
