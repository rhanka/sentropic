import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { DpopVerifyError, verifyDpopProof } from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const htm = 'GET';
const htu = 'http://localhost/oauth/userinfo';

const sha256Base64url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

type ProofKeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

const createProof = async (input: {
  keyPair: ProofKeyPair;
  jti: string;
  htm?: string;
  htu?: string;
  iat?: number;
  accessToken?: string;
  ath?: string;
}): Promise<string> => {
  const claims: Record<string, unknown> = {
    htm: input.htm ?? htm,
    htu: input.htu ?? htu,
    iat: input.iat ?? Math.floor(now.getTime() / 1000),
    jti: input.jti,
  };
  if (input.ath !== undefined) claims.ath = input.ath;
  else if (input.accessToken !== undefined) claims.ath = await sha256Base64url(input.accessToken);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', jwk: await exportJWK(input.keyPair.publicKey), typ: 'dpop+jwt' })
    .sign(input.keyPair.privateKey);
};

const createReplayStore = () => {
  const seen = new Set<string>();
  return (jti: string): boolean => {
    if (seen.has(jti)) return false;
    seen.add(jti);
    return true;
  };
};

describe('verifyDpopProof', () => {
  it('accepts a valid proof and returns its jkt + jti', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const expectedJkt = await calculateJwkThumbprint(await exportJWK(keyPair.publicKey));
    const proof = await createProof({ jti: 'p-1', keyPair });

    const result = await verifyDpopProof({ htm, htu, now, proof });

    expect(result).toEqual({ jkt: expectedJkt, jti: 'p-1' });
  });

  it('rejects an htm mismatch', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await createProof({ jti: 'htm', keyPair });
    await expect(verifyDpopProof({ htm: 'POST', htu, now, proof })).rejects.toThrow(/htm/iu);
  });

  it('rejects an htu mismatch', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await createProof({ jti: 'htu', keyPair });
    await expect(verifyDpopProof({ htm, htu: 'http://localhost/oauth/revoke', now, proof })).rejects.toThrow(/htu/iu);
  });

  it('rejects a stale iat outside the skew window', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await createProof({ iat: 1, jti: 'iat', keyPair });
    await expect(verifyDpopProof({ htm, htu, now, proof })).rejects.toThrow(/iat/iu);
  });

  it('rejects a proof missing jti', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await new SignJWT({ htm, htu, iat: Math.floor(now.getTime() / 1000) })
      .setProtectedHeader({ alg: 'EdDSA', jwk: await exportJWK(keyPair.publicKey), typ: 'dpop+jwt' })
      .sign(keyPair.privateKey);
    await expect(verifyDpopProof({ htm, htu, now, proof })).rejects.toThrow(/jti/iu);
  });

  it('rejects a proof with the wrong typ header', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await new SignJWT({ htm, htu, iat: Math.floor(now.getTime() / 1000), jti: 'typ' })
      .setProtectedHeader({ alg: 'EdDSA', jwk: await exportJWK(keyPair.publicKey), typ: 'jwt' })
      .sign(keyPair.privateKey);
    await expect(verifyDpopProof({ htm, htu, now, proof })).rejects.toBeInstanceOf(DpopVerifyError);
  });

  it('rejects an ath that does not match the access token', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await createProof({ accessToken: 'access-token', ath: 'tampered', jti: 'ath', keyPair });
    await expect(verifyDpopProof({ accessToken: 'access-token', htm, htu, now, proof })).rejects.toThrow(/ath/iu);
  });

  it('accepts a matching ath when bound to an access token', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await createProof({ accessToken: 'access-token', jti: 'ath-ok', keyPair });
    await expect(verifyDpopProof({ accessToken: 'access-token', htm, htu, now, proof })).resolves.toMatchObject({
      jti: 'ath-ok',
    });
  });

  it('enforces single-use jti via the replay guard', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const replay = createReplayStore();
    const proof = await createProof({ jti: 'replay', keyPair });

    await expect(verifyDpopProof({ htm, htu, now, proof, replay })).resolves.toMatchObject({ jti: 'replay' });
    await expect(verifyDpopProof({ htm, htu, now, proof, replay })).rejects.toThrow(/already used/iu);
  });

  it('rejects a proof whose key does not match expectedJkt', async () => {
    const keyPair = await generateKeyPair('EdDSA');
    const proof = await createProof({ jti: 'jkt', keyPair });
    await expect(verifyDpopProof({ expectedJkt: 'some-other-jkt', htm, htu, now, proof })).rejects.toThrow(
      /does not match/iu
    );
  });
});
