import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import { fromRemoteJwks, TokenVerifyError, verifyAccessToken } from '../src/index.js';
import { createSigningKey, type TestSigningKey } from './__fixtures__/jwks.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const issuer = 'https://idp.sentropic.test';
const audience = 'https://mcp.sentropic.test';

const startJwksServer = (key: TestSigningKey): Promise<{ url: string; close: () => Promise<void>; server: Server }> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [key.publicJwk] }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        close: () => new Promise<void>((done) => server.close(() => done())),
        server,
        url: `http://127.0.0.1:${port}/.well-known/jwks.json`,
      });
    });
  });

const signAccessToken = async (key: TestSigningKey): Promise<string> =>
  new SignJWT({ scope: 'service:ping' })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('remote-rp')
    .setExpirationTime(Math.floor((now.getTime() + 900_000) / 1000))
    .sign(key.privateKey);

let teardown: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (teardown) await teardown();
  teardown = null;
});

describe('fromRemoteJwks', () => {
  it('verifies a token whose key is served by a remote JWKS endpoint', async () => {
    const key = await createSigningKey('remote-kid');
    const { url, close } = await startJwksServer(key);
    teardown = close;

    const keySource = fromRemoteJwks(url, { cacheMaxAgeSec: 600 });
    const token = await signAccessToken(key);

    const claims = await verifyAccessToken({ audience, issuer, keySource, now, token });
    expect(claims.sub).toBe('remote-rp');
  });

  it('fails verification when the remote JWKS lacks the token key', async () => {
    const served = await createSigningKey('served-kid');
    const other = await createSigningKey('other-kid');
    const { url, close } = await startJwksServer(served);
    teardown = close;

    const keySource = fromRemoteJwks(url);
    const token = await signAccessToken(other);

    await expect(verifyAccessToken({ audience, issuer, keySource, now, token })).rejects.toBeInstanceOf(
      TokenVerifyError
    );
  });
});
