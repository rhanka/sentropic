import { generateKeyPairSync } from 'node:crypto';

import { exportJWK } from 'jose';

import type { JwksKeyRecord, JwksPort } from '../../src/index.js';

export interface MemoryJwksPort extends JwksPort {
  keys: JwksKeyRecord[];
}

export const createJwksKeyRecord = async (input: {
  active: boolean;
  kid: string;
  now?: Date;
}): Promise<JwksKeyRecord> => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicJwk = await exportJWK(publicKey);
  const now = input.now ?? new Date('2026-01-01T00:00:00.000Z');

  return {
    active: input.active,
    alg: 'EdDSA',
    createdAt: now,
    crv: 'Ed25519',
    kid: input.kid,
    privateKey,
    publicJwk: {
      ...publicJwk,
      alg: 'EdDSA',
      kid: input.kid,
      use: 'sig',
    },
    rotatedAt: input.active ? null : now,
  };
};

export const createMemoryJwksPort = (keys: JwksKeyRecord[]): MemoryJwksPort => ({
  keys,
  async findKeyByKid(kid) {
    return this.keys.find((key) => key.kid === kid) ?? null;
  },
  async getActiveKey() {
    return this.keys.find((key) => key.active) ?? null;
  },
  async listPublicKeys() {
    return this.keys;
  },
});
