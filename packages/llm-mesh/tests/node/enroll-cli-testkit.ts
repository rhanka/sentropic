// Shared stub-fetch harness for the llm-mesh-enroll CLI tests.
// Every secret below is fake and stays out of CLI output by contract.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliWriters } from '../../src/node/cli/enroll-args.js';

export const KEY_ENV = 'TEST_LLM_MESH_ENROLL_KEY';
export const PASSPHRASE = 'test-only-keyring-passphrase-1';
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

export const stubMuseDeviceFetch = (): { fetchFn: typeof fetch; calls: StubCalls } => {
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
      return json({ api_key: MINTED_KEY, user_email: OWNER_EMAIL });
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
