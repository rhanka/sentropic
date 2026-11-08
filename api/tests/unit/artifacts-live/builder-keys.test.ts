import { generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILDER_KEY_ENV, builderKeys, builderPublicKey } from '../../../src/services/artifacts/live/builder-keys';

const pair = () => generateKeyPairSync('ed25519');
const der = (key: KeyObject, type: 'pkcs8' | 'spki') => key.export({ type, format: 'der' } as never).toString('base64');
const { signing, hostReceipts } = BUILDER_KEY_ENV;
function setup(ringSize = 1) {
  const signer = pair(); const ring = Array.from({ length: ringSize }, pair);
  const values: Record<string, string | undefined> = {
    [signing]: JSON.stringify({ kid: 'builder-2026-11', privateKey: der(signer.privateKey, 'pkcs8') }),
    [hostReceipts]: JSON.stringify(ring.map((p, i) => ({ kid: `immo-receipt-${i}`, publicKey: der(p.publicKey, 'spki') }))),
  };
  return { signer, ring, values };
}
const unconfigured = expect.objectContaining({ code: 'builder_unavailable', reason: 'keys_unconfigured' });

describe('builder handoff keys (fixed env names, kid rotation)', () => {
  it('fixes the env names of the builder signing key and of the host receipt key ring', () => {
    expect(BUILDER_KEY_ENV).toEqual({ signing: 'ARTIFACT_BUILDER_HANDOFF_SIGNING_KEY_JSON', hostReceipts: 'ARTIFACT_BUILDER_HOST_RECEIPT_KEYS_JSON' });
  });
  it('loads the current Ed25519 signing key with its kid', () => {
    const s = setup(); const signer = builderKeys(s.values).signingKey();
    expect(signer.kid).toBe('builder-2026-11');
    expect(verify(null, Buffer.from('m'), s.signer.publicKey, sign(null, Buffer.from('m'), signer.key))).toBe(true);
  });
  it('hands the content host only the public key and its kid', () => {
    const s = setup();
    expect(builderPublicKey(builderKeys(s.values).signingKey())).toEqual({ kid: 'builder-2026-11', publicKey: der(s.signer.publicKey, 'spki') });
  });
  it('resolves every receipt kid of the ring during a rotation overlap, and no other kid', () => {
    const s = setup(2); const { hostKeys } = builderKeys(s.values);
    expect(der(hostKeys('immo-receipt-0')!, 'spki')).toBe(der(s.ring[0].publicKey, 'spki'));
    expect(der(hostKeys('immo-receipt-1')!, 'spki')).toBe(der(s.ring[1].publicKey, 'spki'));
    expect(hostKeys('immo-receipt-2')).toBeUndefined(); expect(hostKeys('builder-2026-11')).toBeUndefined();
  });
  it('refuses an absent, malformed or non-Ed25519 key, a duplicated kid or an oversized ring', () => {
    const s = setup(); const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }); const ring = JSON.parse(s.values[hostReceipts]!);
    const signer = (kid: string, privateKey: string) => JSON.stringify({ kid, privateKey });
    for (const change of [{ [signing]: undefined }, { [hostReceipts]: undefined }, { [signing]: '{' }, { [hostReceipts]: '[]' },
      { [signing]: signer('bad kid!', der(s.signer.privateKey, 'pkcs8')) }, { [signing]: signer('k', der(rsa.privateKey, 'pkcs8')) },
      { [signing]: signer('k', der(s.signer.publicKey, 'spki')) },
      { [signing]: JSON.stringify({ kid: 'k', privateKey: der(s.signer.privateKey, 'pkcs8'), extra: 1 }) },
      { [hostReceipts]: JSON.stringify([{ kid: 'a', publicKey: der(rsa.publicKey, 'spki') }]) },
      { [hostReceipts]: JSON.stringify([{ kid: 'a', publicKey: der(s.signer.privateKey, 'pkcs8') }]) },
      { [hostReceipts]: JSON.stringify([...ring, ring[0]]) },
      { [hostReceipts]: JSON.stringify([0, 1, 2, 3, 4].map(i => ({ ...ring[0], kid: `k${i}` }))) }]) {
      expect(() => builderKeys({ ...s.values, ...change })).toThrow(unconfigured);
    }
  });
});
