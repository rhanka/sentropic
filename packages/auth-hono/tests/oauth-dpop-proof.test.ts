import { generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { verifyOAuthDpopProof } from '../src/index.js';
import { createDpopProof } from './__fixtures__/oauth-flow-fixtures.js';
import { createOauthPorts } from './__fixtures__/oauth-fixtures.js';

describe('verifyOAuthDpopProof', () => {
  it('rejects htm mismatch, htu mismatch, stale iat, duplicate jti, and wrong ath', async () => {
    const { ports } = await createOauthPorts();
    const keyPair = await generateKeyPair('EdDSA');
    const base = {
      htm: 'GET',
      htu: 'http://localhost/oauth/userinfo',
      keyPair,
    };

    await expect(
      verifyOAuthDpopProof({
        htm: 'POST',
        htu: base.htu,
        ports,
        proof: await createDpopProof({ ...base, jti: 'htm-mismatch' }),
      })
    ).rejects.toThrow(/htm/iu);

    await expect(
      verifyOAuthDpopProof({
        htm: 'GET',
        htu: 'http://localhost/oauth/revoke',
        ports,
        proof: await createDpopProof({ ...base, jti: 'htu-mismatch' }),
      })
    ).rejects.toThrow(/htu/iu);

    await expect(
      verifyOAuthDpopProof({
        htm: 'GET',
        htu: base.htu,
        ports,
        proof: await createDpopProof({ ...base, iat: 1, jti: 'stale-iat' }),
      })
    ).rejects.toThrow(/iat/iu);

    const replayed = await createDpopProof({ ...base, jti: 'replayed-jti' });
    await expect(verifyOAuthDpopProof({ htm: 'GET', htu: base.htu, ports, proof: replayed })).resolves.toMatchObject({
      jti: 'replayed-jti',
    });
    await expect(verifyOAuthDpopProof({ htm: 'GET', htu: base.htu, ports, proof: replayed })).rejects.toThrow(/already used/iu);

    await expect(
      verifyOAuthDpopProof({
        accessToken: 'access-token',
        htm: 'GET',
        htu: base.htu,
        ports,
        proof: await createDpopProof({ ...base, ath: 'other-token', jti: 'wrong-ath' }),
      })
    ).rejects.toThrow(/ath/iu);
  });
});
