import { Buffer } from 'node:buffer';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryCustodyStateStore,
  type ClusterMeshRegistration,
  type CustodyBinding,
  type SignedCustodyToken,
} from '../src/index.js';
import {
  createEphemeralCustodyKey,
  verifyCustodySignature,
} from '../src/runtime/custody-crypto.js';
import { issueBoundedCustodyToken } from '../src/runtime/custody-issuance.js';
import { validateCustodyToken } from '../src/runtime/custody-token-validation.js';
import { custodySignaturePayload } from '../src/runtime/custody-wire.js';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const registration: ClusterMeshRegistration = {
  registrationId: 'registration-1', generationId: 'generation-1',
  principalId: 'holder-1', workspaceId: 'workspace-1',
  custodyHolderPrincipalId: 'holder-1', custodyEpoch: 1,
  actuatorRef: 'pty:session-1', status: 'active',
  expiresAt: '2026-09-13T14:00:00.000Z', leaseExpiresAt: '2026-09-13T14:00:00.000Z',
};
const binding: CustodyBinding = {
  registrationId: registration.registrationId, custodyId: 'custody-1',
  holderPrincipalId: 'holder-1', epoch: 1, meshDomain: 'mesh.example.test',
  status: 'active', expiresAt: registration.expiresAt,
};

async function fixture() {
  const key = createEphemeralCustodyKey('custody-source-1');
  const state = new InMemoryCustodyStateStore();
  const bindings = new Map([[binding.registrationId, binding]]);
  const registrations = { async find() { return registration; } };
  const token = (await issueBoundedCustodyToken({
    request: {
      registrationId: registration.registrationId, action: 'drive',
      holderPrincipalId: binding.holderPrincipalId, invocationId: 'invocation-1',
    },
    registrations, bindings, state, key, maximumTtlMs: 60_000, now: NOW,
  }))!;
  const expected = {
    audience: token.audience, registrationId: token.registrationId, action: token.action,
    holderPrincipalId: token.holderPrincipalId, epoch: token.epoch,
    custodyId: token.custodyId, invocationId: token.invocationId,
  };
  const decide = (candidate: SignedCustodyToken, inspectState: boolean) => validateCustodyToken({
    token: candidate, expected, registrations, bindings, state, key,
    maximumTtlMs: 60_000, clockSkewMs: 0, now: NOW, inspectState,
  });
  return { decide, key, token };
}

const withSignature = (token: SignedCustodyToken, signatureBase64Url: string): SignedCustodyToken => ({
  ...token, evidence: { ...token.evidence, signatureBase64Url },
});

async function expectFailClosed(
  decide: (token: SignedCustodyToken, inspectState: boolean) => ReturnType<typeof validateCustodyToken>,
  token: SignedCustodyToken,
) {
  await expect(decide(token, true)).resolves.toEqual({ ok: false, reason: 'untrusted' });
  await expect(decide(token, false)).resolves.toEqual({ ok: false, reason: 'untrusted' });
}

describe('custody token algorithm and key confusion', () => {
  it.each(['none', 'HS256', 'RS256', 'ES256'])('should reject the %s algorithm', async (algorithm) => {
    const { decide, token } = await fixture();
    const confused = {
      ...token, issuer: { ...token.issuer, algorithm },
    } as unknown as SignedCustodyToken;
    await expectFailClosed(decide, confused);
  });

  it.each([
    ['Ed448', (payload: Uint8Array) => {
      const { privateKey, publicKey } = generateKeyPairSync('ed448');
      return {
        publicKeyBase64Url: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
        signatureBase64Url: sign(null, payload, privateKey).toString('base64url'),
      };
    }],
    ['secp256k1', (payload: Uint8Array) => {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
      return {
        publicKeyBase64Url: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
        signatureBase64Url: sign('sha256', payload, privateKey).toString('base64url'),
      };
    }],
  ] as const)('should reject a signature produced by a %s key', async (_curve, forge) => {
    const { decide, token } = await fixture();
    const payload = custodySignaturePayload(token);
    const confusedKey = forge(payload);
    expect(verifyCustodySignature({ ...confusedKey, payload })).toBe(false);
    const confused = withSignature(token, confusedKey.signatureBase64Url);
    await expectFailClosed(decide, confused);
  });

  it('should reject an HMAC forged with the public key as its secret', async () => {
    const { decide, key, token } = await fixture();
    const trust = await key.trustRoot.resolve(key.issuer);
    expect(trust).not.toBeNull();
    const publicKey = Buffer.from(trust!.publicKeyBase64Url, 'base64url');
    const signature = createHmac('sha256', publicKey)
      .update(custodySignaturePayload(token)).digest('base64url');
    await expectFailClosed(decide, withSignature(token, signature));
  });
});
