import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { liveKeyId, type KeyResolver, type SigningKey } from '@sentropic/artifacts/live-host';
import { LiveError } from './records';

/** Env names of the SG4b handoff keys (owner sentropic; values live in the environment secret, never in git or logs).
 * - signing: {"kid","privateKey"}, the builder's current Ed25519 key (PKCS#8 DER, base64). It signs the handoff and the
 *   host job request; the content host (immo) holds its public key and kid (`builderPublicKey`).
 * - hostReceipts: [{"kid","publicKey"}], the content host's receipt public keys (SPKI DER, base64); two during an overlap.
 * Rotation cycle: README.md « SG4b handoff keys ». */
export const BUILDER_KEY_ENV = Object.freeze({
  signing: 'ARTIFACT_BUILDER_HANDOFF_SIGNING_KEY_JSON', hostReceipts: 'ARTIFACT_BUILDER_HOST_RECEIPT_KEYS_JSON',
});
const MAX_RING = 4;
const unconfigured = (): never => { throw new LiveError('builder_unavailable', 'keys_unconfigured'); };
const ed25519 = (key: KeyObject) => (key.asymmetricKeyType === 'ed25519' ? key : unconfigured());
function entry(raw: unknown, field: 'privateKey' | 'publicKey') {
  if (typeof raw !== 'object' || raw === null || Object.keys(raw).sort().join() !== `kid,${field}`) return unconfigured();
  const { kid, [field]: key } = raw as Record<string, unknown>;
  return liveKeyId(kid) && typeof key === 'string' && key ? { kid, der: Buffer.from(key, 'base64') } : unconfigured();
}
function json(value: string | undefined): unknown {
  try { return JSON.parse(value ?? ''); } catch { return unconfigured(); }
}

/** Builder keys of this environment; any absent or invalid value refuses to compose the builder service. */
export function builderKeys(env: Readonly<Record<string, string | undefined>>): { signingKey(): SigningKey; hostKeys: KeyResolver } {
  const own = entry(json(env[BUILDER_KEY_ENV.signing]), 'privateKey');
  let signer: SigningKey;
  try { signer = Object.freeze({ kid: own.kid, key: ed25519(createPrivateKey({ key: own.der, format: 'der', type: 'pkcs8' })) }); }
  catch { return unconfigured(); }
  const ring = json(env[BUILDER_KEY_ENV.hostReceipts]);
  if (!Array.isArray(ring) || ring.length < 1 || ring.length > MAX_RING) return unconfigured();
  const keys = new Map<string, KeyObject>();
  for (const raw of ring) {
    const { kid, der } = entry(raw, 'publicKey');
    if (keys.has(kid)) unconfigured();
    try { keys.set(kid, ed25519(createPublicKey({ key: der, format: 'der', type: 'spki' }))); } catch { unconfigured(); }
  }
  return { signingKey: () => signer, hostKeys: kid => keys.get(kid) };
}
/** What the content host receives for its builder key ring: the kid and the public key, never the private key. */
export const builderPublicKey = (signer: SigningKey) =>
  ({ kid: signer.kid, publicKey: createPublicKey(signer.key).export({ type: 'spki', format: 'der' }).toString('base64') });
