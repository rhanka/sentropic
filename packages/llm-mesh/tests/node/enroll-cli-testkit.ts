// Shared stub-fetch harness for the llm-mesh-enroll CLI tests.
// Every secret below is fake and stays out of CLI output by contract.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES, type CliWriters } from '../../src/node/cli/enroll-args.js';
import { runEnroll } from '../../src/node/cli/enroll-command.js';

export const KEY_ENV = 'TEST_LLM_MESH_ENROLL_KEY';
// 32-byte test key as 64 hex chars (the CLI refuses passphrase fallback).
export const PASSPHRASE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const DCA_TOKEN = 'dca-test-token-abc';
export const MINTED_KEY = 'minted-test-api-key-xyz';
export const REFRESH_TOKEN = 'refresh-test-token-xyz';
export const OWNER_EMAIL = 'owner@example.test';

export const captureWriters = (): CliWriters & { outLines: string[]; errLines: string[] } => {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  };
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

export interface StubCalls {
  urls: string[];
  bodies: unknown[];
}

export const stubMuseDeviceFetch = (overrides: { email?: string; apiKey?: string } = {}): { fetchFn: typeof fetch; calls: StubCalls } => {
  const email = overrides.email ?? OWNER_EMAIL;
  const apiKey = overrides.apiKey ?? MINTED_KEY;
  const calls: StubCalls = { urls: [], bodies: [] };
  const decode = (body: unknown): unknown => {
    if (typeof body !== 'string') return body;
    try {
      return Object.fromEntries(new URLSearchParams(body).entries());
    } catch {
      return body;
    }
  };
  const fetchFn = (async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    calls.urls.push(u);
    calls.bodies.push(decode(init?.body));
    if (u.includes('/oidc/device/authorization/')) {
      return json({
        device_code: 'device-test-code',
        user_code: 'USER-TEST-1',
        verification_uri: 'https://accountscenter.meta.com/muse_code/',
        expires_in: 900,
        interval: 5,
      });
    }
    if (u.includes('/oidc/device/token/')) {
      return json({ access_token: DCA_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 3600 });
    }
    if (u.includes('/muse-code/key')) {
      return json({ api_key: apiKey, user_email: email });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { fetchFn, calls };
};

export const stubServingFetch = (
  status: number,
  payload: unknown,
): { fetchFn: typeof fetch; calls: string[] } => {
  const calls: string[] = [];
  const fetchFn = (async (url: unknown) => {
    calls.push(String(url));
    return status === 200
      ? json(payload, 200)
      : new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
};

export const tempDir = async (): Promise<{ dir: string; cleanup: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-enroll-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
};

export const allOutput = (writers: { outLines: string[]; errLines: string[] }): string =>
  [...writers.outLines, ...writers.errLines].join('\n');

export const enrollOne = async (dir: string, email: string, label: string): Promise<string> => {
  const env = { [KEY_ENV]: PASSPHRASE };
  const { fetchFn } = stubMuseDeviceFetch({ email, apiKey: `minted-${email}` });
  const writers = captureWriters();
  const code = await runEnroll(
    {
      command: 'enroll',
      provider: 'muse-code',
      keyringDir: dir,
      keyringKeyEnv: KEY_ENV,
      ownerScope: 'tenant-1:immo-detection',
      label,
    },
    { fetchFn, writers, env },
  );
  if (code !== EXIT_CODES.ok) throw new Error(`enrollOne failed with exit ${code}`);
  const stored = JSON.parse(writers.outLines[1] as string) as { accountId: string };
  return stored.accountId;
};
