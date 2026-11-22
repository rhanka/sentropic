import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgyTokenReadError,
  parseCloudCodeCredentialPayload,
  readAgyFromSecretTool,
  readCredentialFromStdin,
} from '../../src/node/cli/agy-token-reader.js';

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
  });

  it('spawns secret-tool with fixed args and allowlisted env, handles ENOENT, stderr, size cap, and timeout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-mesh-st-'));
    dirs.push(dir);

    const okScript = await writeScript(dir, 'secret-tool-ok', [
      'if [ "$*" != "lookup service gemini username antigravity" ]; then exit 9; fi',
      'if [ -n "${AMBIENT_SECRET:-}" ]; then exit 8; fi',
      'if [ "$DBUS_SESSION_BUS_ADDRESS" != "unix:path=/tmp/fake-bus" ]; then exit 7; fi',
      `printf '%s' '${makeAgyPayload()}'`,
    ].join('\n'));
    const raw = await readAgyFromSecretTool({
      binaryPath: okScript,
      env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/fake-bus', AMBIENT_SECRET: 'must-not-pass' },
    });
    expect(parseCloudCodeCredentialPayload(raw).refreshToken).toBe(FAKE_REFRESH);

    await expect(readAgyFromSecretTool({ binaryPath: join(dir, 'missing-secret-tool') }))
      .rejects.toThrow(/\/usr\/bin\/secret-tool.*--credential-stdin/i);

    const errScript = await writeScript(dir, 'secret-tool-err', `echo "leak-${FAKE_REFRESH}" >&2; exit 1`);
    const err = await readAgyFromSecretTool({ binaryPath: errScript }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgyTokenReadError);
    expect((err as Error).message).not.toContain(FAKE_REFRESH);

    const bigScript = await writeScript(dir, 'secret-tool-big', 'head -c 70000 /dev/zero | tr "\\0" "a"');
    await expect(readAgyFromSecretTool({ binaryPath: bigScript })).rejects.toThrow(/maximum allowed size/i);

    const slowScript = await writeScript(dir, 'secret-tool-slow', 'sleep 5');
    await expect(readAgyFromSecretTool({ binaryPath: slowScript, timeoutMs: 120 }))
      .rejects.toThrow(/timed out/i);
  });
});
