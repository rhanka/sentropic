// @sentropic/llm-mesh/node/cli/enroll-args.ts
//
// Shared argument parsing, exit codes, and keyring opening for the
// llm-mesh-enroll CLI. Secrets never enter error messages: only the env
// var NAME is quoted, never its value.

import { stderr, stdout } from 'node:process';
import { CodexEnrollmentProvider } from '../../enrollment/codex.js';
import type { EnrollmentProvider } from '../../enrollment/contracts.js';
import { MuseCodeEnrollmentProvider } from '../../enrollment/muse-code.js';
import {
  deriveKeyringMasterKey,
  EncryptedFileKeyring,
} from '../keyring/encrypted-file-keyring.js';
import { LocalAccountTransportService } from '../../service/local-account-transport-service.js';

export const EXIT_CODES = {
  ok: 0,
  usage: 2,
  enrollmentFailed: 3,
  accountNotFound: 4,
  keyringKey: 5,
  probeFailed: 6,
  billingNotConfigured: 7,
} as const;

export interface CliWriters {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface EnrollCliDeps {
  fetchFn?: typeof fetch;
  writers?: CliWriters;
  env?: Record<string, string | undefined>;
}

export interface ParsedArgs {
  command: 'enroll' | 'probe' | 'help';
  provider: string;
  keyringDir?: string;
  keyringKeyEnv?: string;
  ownerScope?: string;
  label?: string;
  account?: string;
  model?: string;
  effort?: string;
  maxAttempts?: number;
}

const KNOWN_FLAGS = new Set([
  'provider',
  'keyring-dir',
  'keyring-key-env',
  'owner-scope',
  'label',
  'account',
  'model',
  'effort',
  'max-attempts',
  'help',
]);

const flagValue = (argv: string[], name: string): string | undefined => {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return undefined;
      return next;
    }
    if (arg.startsWith(`--${name}=`)) {
      const value = arg.slice(name.length + 3);
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
};

const hasFlag = (argv: string[], name: string): boolean =>
  argv.includes(`--${name}`) || argv.some((arg) => arg.startsWith(`--${name}=`));

const rejectUnknownFlags = (argv: string[]): void => {
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2).split('=', 1)[0];
    if (!KNOWN_FLAGS.has(name)) throw new Error(`unknown flag '--${name}'`);
  }
};

export const parseArgs = (argv: string[]): ParsedArgs => {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || hasFlag(argv, 'help')) {
    return { command: 'help', provider: 'muse-code' };
  }
  if (command !== 'enroll' && command !== 'probe') {
    throw new Error(`unknown command '${command}'; expected 'enroll' or 'probe'`);
  }
  rejectUnknownFlags(rest);
  const maxAttemptsRaw = flagValue(rest, 'max-attempts');
  return {
    command,
    provider: flagValue(rest, 'provider') ?? 'muse-code',
    keyringDir: flagValue(rest, 'keyring-dir'),
    keyringKeyEnv: flagValue(rest, 'keyring-key-env'),
    ownerScope: flagValue(rest, 'owner-scope'),
    label: flagValue(rest, 'label'),
    account: flagValue(rest, 'account'),
    model: flagValue(rest, 'model') ?? 'muse-wonder-1.0',
    effort: flagValue(rest, 'effort') ?? 'low',
    ...(maxAttemptsRaw !== undefined ? { maxAttempts: Number(maxAttemptsRaw) } : {}),
  };
};

export const usageText = (): string =>
  [
    'llm-mesh-enroll enroll --provider muse-code --keyring-dir <dir>',
    '  --owner-scope <ref> [--label <label>] --keyring-key-env <NAME>',
    '  [--max-attempts <n>]',
    'llm-mesh-enroll probe --provider muse-code --keyring-dir <dir>',
    '  --account <id> --model muse-wonder-1.0 --effort low --keyring-key-env <NAME>',
  ].join('\n');

export const defaultWriters = (): CliWriters => ({
  out: (line) => stdout.write(`${line}\n`),
  err: (line) => stderr.write(`${line}\n`),
});

export const fail = (writers: CliWriters, code: number, message: string): number => {
  writers.err(JSON.stringify({ status: 'error', code, message }));
  return code;
};

export const resolveMasterKey = (
  keyringKeyEnv: string | undefined,
  env: Record<string, string | undefined>,
): { key?: Buffer; error?: string } => {
  if (!keyringKeyEnv) return { error: 'missing --keyring-key-env <NAME>' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyringKeyEnv)) {
    return { error: `invalid --keyring-key-env name '${keyringKeyEnv}'` };
  }
  const raw = env[keyringKeyEnv];
  if (typeof raw !== 'string' || raw.length === 0) {
    return { error: `keyring key env var '${keyringKeyEnv}' is missing or empty` };
  }
  try {
    return { key: deriveKeyringMasterKey(raw) };
  } catch {
    return { error: `keyring key env var '${keyringKeyEnv}' must hold 32 bytes as 64 hex chars or 44/43-char base64` };
  }
};

const buildProviders = (fetchFn: typeof fetch): Map<string, EnrollmentProvider> =>
  new Map<string, EnrollmentProvider>([
    ['muse-code', new MuseCodeEnrollmentProvider({ fetchFn })],
    ['codex', new CodexEnrollmentProvider({ fetchFn })],
  ]);

export const openService = (
  keyringDir: string,
  masterKey: Buffer,
  fetchFn: typeof fetch,
): LocalAccountTransportService =>
  new LocalAccountTransportService(
    new EncryptedFileKeyring(keyringDir, masterKey),
    buildProviders(fetchFn),
    { resolveConfig: async () => ({}) },
  );
