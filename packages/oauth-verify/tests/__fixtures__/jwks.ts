import { exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';

import type { JwksProviderKey, JwksProviderLike } from '../../src/index.js';

export interface TestSigningKey {
  kid: string;
  alg: string;
  publicJwk: JWK;
  privateKey: KeyLike;
}

export const createSigningKey = async (kid = 'kid-1'): Promise<TestSigningKey> => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA');
  const publicJwk = { ...(await exportJWK(publicKey)), alg: 'EdDSA', kid, use: 'sig' };
  return { alg: 'EdDSA', kid, privateKey, publicJwk };
};

/** Minimal in-process JWKS provider over a fixed key set (mirrors auth-hono's JwksPort shape). */
export const createMemoryJwksProvider = (keys: TestSigningKey[]): JwksProviderLike => {
  const toRecord = (key: TestSigningKey): JwksProviderKey => ({ alg: key.alg, publicJwk: key.publicJwk });
  return {
    async findKeyByKid(kid) {
      const match = keys.find((key) => key.kid === kid);
      return match ? toRecord(match) : null;
    },
    async getActiveKey() {
      return keys[0] ? toRecord(keys[0]) : null;
    },
  };
};
