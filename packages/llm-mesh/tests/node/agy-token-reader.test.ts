import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgyTokenReadError,
  parseCloudCodeCredentialPayload,
  readAgyFromSecretTool,
  readCredentialFromStdin,
} from '../../src/node/cli/agy-token-reader.js';
import { makeSessionBusSocket } from './enroll-cli-testkit.js';

const FAKE_ACCESS = 'ya29.fake-access-reader-111';
const FAKE_REFRESH = '1//fake-refresh-reader-222';
const FAKE_EXPIRY = '2026-12-01T00:00:00.000Z';

const makeAgyPayload = (extra: Record<string, unknown> = {}): string => JSON.stringify({
  token: { access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, token_type: 'Bearer', expiry: FAKE_EXPIRY },
  auth_method: 'consumer',
  id_token_email: 'owner@example.test',
  ...extra,
});

const streamOf = (chunks: (Buffer | string)[], isTTY = false) => ({
  isTTY,
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
  },
});

const writeScript = async (dir: string, name: string, body: string): Promise<string> => {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
};

describe('agy-token-reader (strict stdin schema & thin secret-tool reader)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('parses strict wrapped and flat payloads, discards email, and rejects invalid shapes without echoing secrets', () => {
    const wrapped = parseCloudCodeCredentialPayload(makeAgyPayload());
    expect(wrapped).toEqual({ accessToken: FAKE_ACCESS, refreshToken: FAKE_REFRESH, expiresAt: FAKE_EXPIRY });
    expect('email' in wrapped).toBe(false);

    const flat = parseCloudCodeCredentialPayload(JSON.stringify({ accessToken: FAKE_ACCESS, refreshToken: FAKE_REFRESH }));
    expect(flat).toEqual({ accessToken: FAKE_ACCESS, refreshToken: FAKE_REFRESH });

    // A raw Google token-endpoint response parses flat: scope/id_token and
    // refresh_token_expires_in are discarded like other non-token metadata.
    const google = parseCloudCodeCredentialPayload(JSON.stringify({
      access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, expires_in: 3600,
      token_type: 'Bearer', scope: 'openid email', id_token: 'fake.id.token',
      refresh_token_expires_in: 604800,
    }));
    expect(google).toEqual({ accessToken: FAKE_ACCESS, refreshToken: FAKE_REFRESH });

    // CloudCodeEnrollmentProvider.complete() output parses flat too:
    // accountId/authClientConfigVersion are discarded, never trusted.
    const completed = parseCloudCodeCredentialPayload(JSON.stringify({
      accountId: 'acct_cc_producer_ignored', accessToken: FAKE_ACCESS,
      refreshToken: FAKE_REFRESH, expiresAt: FAKE_EXPIRY, authClientConfigVersion: 'v1.0.0',
      scopes: ['openid'],
    }));
    expect(completed).toEqual({ accessToken: FAKE_ACCESS, refreshToken: FAKE_REFRESH, expiresAt: FAKE_EXPIRY });

    for (const raw of [
      JSON.stringify({ access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, id_token: { nested: true } }),
      JSON.stringify({ access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, refresh_token_expires_in: -1 }),
      JSON.stringify({ access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, accountId: 42 }),
    ]) {
      expect(() => parseCloudCodeCredentialPayload(raw)).toThrow(AgyTokenReadError);
    }

    const invalidCases = [
      `not-json ${FAKE_REFRESH}`,
      '[]',
      JSON.stringify({ access_token: FAKE_ACCESS }),
      JSON.stringify({ access_token: FAKE_ACCESS, refresh_token: `${FAKE_REFRESH}\n` }),
      JSON.stringify({ access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, expiry: 'not-a-date' }),
      JSON.stringify({ access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, unknownField: 1 }),
      JSON.stringify({ access_token: FAKE_ACCESS, accessToken: FAKE_ACCESS, refresh_token: FAKE_REFRESH }),
      makeAgyPayload({ unexpected_root: 'x' }),
      JSON.stringify({ token: { access_token: FAKE_ACCESS, refresh_token: FAKE_REFRESH, rogue: true } }),
      'x'.repeat(65 * 1024),
    ];
    for (const raw of invalidCases) {
      let caught: unknown;
      try { parseCloudCodeCredentialPayload(raw); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(AgyTokenReadError);
      expect((caught as Error).message).not.toContain(FAKE_REFRESH);
      expect((caught as Error).message).not.toContain(FAKE_ACCESS);
    }
  });

  it('reads bounded non-TTY stdin and refuses TTY, empty, and oversized streams', async () => {
    const half = makeAgyPayload();
    const raw = await readCredentialFromStdin(streamOf([half.slice(0, 20), half.slice(20)]));
    expect(raw).toBe(half);

    await expect(readCredentialFromStdin(streamOf([half], true))).rejects.toThrow(/TTY/i);
    await expect(readCredentialFromStdin(streamOf(['   ']))).rejects.toThrow(/empty/i);
    await expect(readCredentialFromStdin(streamOf([Buffer.alloc(33 * 1024, 97), Buffer.alloc(33 * 1024, 97)])))
      .rejects.toThrow(/maximum allowed size/i);

    // A stalled pipe is bounded by a deadline instead of wedging forever.
    const stalled = {
      isTTY: false,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{"access_token":"partial', 'utf8');
        await new Promise(() => {});
      },
    };
    await expect(readCredentialFromStdin(stalled, 60)).rejects.toThrow(/timed out/i);
  });

  it('spawns secret-tool with fixed args and allowlisted env, handles ENOENT, stderr, size cap, and timeout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-st-'));
    dirs.push(dir);
    const bus = await makeSessionBusSocket(dir);
    try {
      const okScript = await writeScript(dir, 'secret-tool-ok', [
        'if [ "$*" != "lookup service gemini username antigravity" ]; then exit 9; fi',
        'if [ -n "${AMBIENT_SECRET:-}" ]; then exit 8; fi',
        `if [ "$DBUS_SESSION_BUS_ADDRESS" != "${bus.address}" ]; then exit 7; fi`,
        `printf '%s' '${makeAgyPayload()}'`,
      ].join('\n'));
      const raw = await readAgyFromSecretTool({
        binaryPath: okScript,
        env: { DBUS_SESSION_BUS_ADDRESS: `${bus.address},guid=0123abcd`, AMBIENT_SECRET: 'must-not-pass' },
      });
      expect(parseCloudCodeCredentialPayload(raw).refreshToken).toBe(FAKE_REFRESH);

      await expect(readAgyFromSecretTool({
        binaryPath: join(dir, 'missing-secret-tool'), env: { DBUS_SESSION_BUS_ADDRESS: bus.address },
      })).rejects.toThrow(/\/usr\/bin\/secret-tool.*--credential-stdin/i);

      const errScript = await writeScript(dir, 'secret-tool-err', `echo "leak-${FAKE_REFRESH}" >&2; exit 1`);
      const err = await readAgyFromSecretTool({
        binaryPath: errScript, env: { DBUS_SESSION_BUS_ADDRESS: bus.address },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AgyTokenReadError);
      expect((err as Error).message).toMatch(/missing agy login or locked OS keyring/i);
      expect((err as Error).message).not.toContain(FAKE_REFRESH);

      const bigScript = await writeScript(dir, 'secret-tool-big', 'head -c 70000 /dev/zero | tr "\\0" "a"');
      await expect(readAgyFromSecretTool({
        binaryPath: bigScript, env: { DBUS_SESSION_BUS_ADDRESS: bus.address },
      })).rejects.toThrow(/maximum allowed size/i);

      const slowScript = await writeScript(dir, 'secret-tool-slow', 'sleep 5');
      await expect(readAgyFromSecretTool({
        binaryPath: slowScript, env: { DBUS_SESSION_BUS_ADDRESS: bus.address }, timeoutMs: 120,
      })).rejects.toThrow(/timed out/i);
    } finally { await bus.close(); }
  });

  it('pins secret-tool to a same-uid unix:path session bus and never spawns otherwise', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-bus-'));
    dirs.push(dir);
    const bus = await makeSessionBusSocket(dir);
    const marker = join(dir, 'spawned');
    const script = await writeScript(dir, 'secret-tool-pin', [
      `printf spawned > '${marker}'`,
      `if [ "$DBUS_SESSION_BUS_ADDRESS" != "${bus.address}" ]; then exit 7; fi`,
      `printf '%s' '${makeAgyPayload()}'`,
    ].join('\n'));
    try {
      const refused: Record<string, string | undefined>[] = [
        { DBUS_SESSION_BUS_ADDRESS: 'tcp:host=127.0.0.1,port=4242' },
        { DBUS_SESSION_BUS_ADDRESS: 'nonce-tcp:host=127.0.0.1,port=4242,family=ipv4,noncefile=/tmp/n' },
        { DBUS_SESSION_BUS_ADDRESS: 'unix:abstract=/tmp/dbus-fake' },
        { DBUS_SESSION_BUS_ADDRESS: 'unixexec:path=/bin/true' },
        { DBUS_SESSION_BUS_ADDRESS: `${bus.address};tcp:host=127.0.0.1,port=4242` },
        { DBUS_SESSION_BUS_ADDRESS: 'unix:path=relative/bus' },
        { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/bus' },
        { DBUS_SESSION_BUS_ADDRESS: `unix:path=${script}` },
        {},
      ];
      for (const env of refused) {
        await rm(marker, { force: true });
        const err = await readAgyFromSecretTool({ binaryPath: script, env }).catch((e: unknown) => e);
        expect(err, JSON.stringify(env)).toBeInstanceOf(AgyTokenReadError);
        await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      }

      // XDG_RUNTIME_DIR fallback resolves <dir>/bus when the address is unset.
      const raw = await readAgyFromSecretTool({ binaryPath: script, env: { XDG_RUNTIME_DIR: dir } });
      expect(parseCloudCodeCredentialPayload(raw).refreshToken).toBe(FAKE_REFRESH);
    } finally { await bus.close(); }
  });
});
