#!/usr/bin/env node
// @sentropic/llm-mesh/node/cli/enroll-cli.ts
//
// Generic device-flow enrollment CLI (muse-code first):
// `enroll` stores a seat account, `probe` checks it with one minimal
// generate through MuseAdapter/MuseRuntimeClient. stdout is a machine
// contract (one JSON object per line); secrets never printed.

import { EncryptedFileKeyring } from '../keyring/encrypted-file-keyring.js';
import {
  defaultWriters,
  EXIT_CODES,
  fail,
  parseArgs,
  resolveMasterKey,
  usageText,
  type EnrollCliDeps,
  type ParsedArgs,
} from './enroll-args.js';
import { runEnroll } from './enroll-command.js';

const KNOWN_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

export const runProbe = async (
  args: ParsedArgs,
  deps: EnrollCliDeps = {},
): Promise<number> => {
  const writers = deps.writers ?? defaultWriters();
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  if (!args.keyringDir) return fail(writers, EXIT_CODES.usage, 'missing --keyring-dir <dir>');
  if (!args.account) return fail(writers, EXIT_CODES.usage, 'missing --account <id>');
  const effort = args.effort ?? 'low';
  if (!KNOWN_EFFORTS.has(effort)) {
    return fail(writers, EXIT_CODES.usage, `unknown --effort '${effort}'`);
  }
  const resolved = resolveMasterKey(args.keyringKeyEnv, env);
  if (!resolved.key) return fail(writers, EXIT_CODES.keyringKey, resolved.error ?? 'key error');
  const keyring = new EncryptedFileKeyring(args.keyringDir, resolved.key);
  const raw = await keyring.getSecret(`sentropic-llm-mesh:${args.account}:envelope`);
  if (!raw) {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${args.account}' not found`);
  }
  let accessToken: string;
  try {
    const envelope = JSON.parse(raw) as { accessToken?: unknown };
    if (typeof envelope.accessToken !== 'string' || !envelope.accessToken) throw new Error('bad');
    accessToken = envelope.accessToken;
  } catch {
    return fail(writers, EXIT_CODES.accountNotFound, `account '${args.account}' has no credential`);
  }
  // The Muse Chat wire takes no reasoning controls (the client refuses a
  // non-empty reasoning block), so --effort is validated but not forwarded.
  const { MuseAdapter } = await import('../../adapters.js');
  const { MuseRuntimeClient } = await import('../../transport/muse-runtime-client.js');
  const adapter = new MuseAdapter({ client: new MuseRuntimeClient({ fetch: fetchFn }) });
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
    return fail(writers, EXIT_CODES.probeFailed, error instanceof Error ? error.message : 'probe failed');
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

// Executable entry point (package.json bin); import { run } to embed.
const invokedDirectly = process.argv[1]?.endsWith('enroll-cli.js') ?? false;
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(EXIT_CODES.probeFailed);
    },
  );
}
