// @sentropic/llm-mesh/node/cli/enroll-command.ts
//
// The `enroll` command: start a device flow, print only the grant, poll,
// then persist. stdout is a machine contract (one JSON object per line);
// progress goes to stderr; secrets never printed.

import { EncryptedFileKeyring } from '../keyring/encrypted-file-keyring.js';
import {
  defaultWriters,
  EXIT_CODES,
  fail,
  openService,
  resolveMasterKey,
  type EnrollCliDeps,
  type ParsedArgs,
} from './enroll-args.js';

const relabelAccount = async (
  keyringDir: string,
  masterKey: Buffer,
  accountId: string,
  label: string,
): Promise<string> => {
  const keyring = new EncryptedFileKeyring(keyringDir, masterKey);
  const key = `sentropic-llm-mesh:${accountId}:public`;
  const raw = await keyring.getSecret(key);
  if (!raw) return label;
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    await keyring.setSecret(key, JSON.stringify({ ...record, accountLabel: label }));
  } catch {
    return label;
  }
  return label;
};

export const runEnroll = async (
  args: ParsedArgs,
  deps: EnrollCliDeps = {},
): Promise<number> => {
  const writers = deps.writers ?? defaultWriters();
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  if (!args.keyringDir) return fail(writers, EXIT_CODES.usage, 'missing --keyring-dir <dir>');
  if (!args.ownerScope) return fail(writers, EXIT_CODES.usage, 'missing --owner-scope <ref>');
  const maxAttempts = args.maxAttempts ?? 60;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    return fail(writers, EXIT_CODES.usage, 'invalid --max-attempts <n>');
  }
  const resolved = resolveMasterKey(args.keyringKeyEnv, env);
  if (!resolved.key) return fail(writers, EXIT_CODES.keyringKey, resolved.error ?? 'key error');
  const service = openService(args.keyringDir, resolved.key, fetchFn);
  let session;
  try {
    session = await service.enroll(args.provider, {
      configRef: 'default',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1',
      ownerScope: args.ownerScope,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'enroll failed';
    return fail(writers, EXIT_CODES.enrollmentFailed, message);
  }
  if (session.kind !== 'device-code') {
    return fail(writers, EXIT_CODES.usage, `provider '${args.provider}' has no device flow`);
  }
  // First stdout line: the grant the owner approves. The user code and
  // URL are public by device-flow design; no secret is printed.
  writers.out(JSON.stringify({
    verificationUrl: session.verificationUrl,
    userCode: session.userCode,
    expiresAt: session.expiresAt,
  }));
  writers.err('Waiting for the owner to approve the device login.');
  try {
    const completed = args.provider === 'muse-code'
      ? await service.completeMuseDeviceImport(session.enrollmentId, args.ownerScope, maxAttempts)
      : await service.pollForCompletion(session.enrollmentId);
    const label = args.label
      ? await relabelAccount(args.keyringDir, resolved.key, completed.accountId, args.label)
      : completed.label;
    // Last stdout line: the stored account only.
    writers.out(JSON.stringify({ accountId: completed.accountId, label }));
    return EXIT_CODES.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'poll failed';
    return fail(writers, EXIT_CODES.enrollmentFailed, message);
  }
};
