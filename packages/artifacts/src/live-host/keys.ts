import type { KeyObject } from 'node:crypto';

/** Key id carried in every signed live-host message, so a verifier accepts old and new keys during a rotation overlap. */
export const LIVE_KEY_ID = /^[A-Za-z0-9._:-]{1,128}$/;
export const liveKeyId = (kid: unknown): kid is string => typeof kid === 'string' && LIVE_KEY_ID.test(kid);
/** Current signing key and its id. */
export interface SigningKey { readonly kid: string; readonly key: KeyObject }
/** Verifier key set: returns the public key of a known id, undefined otherwise. */
export type KeyResolver = (kid: string) => KeyObject | undefined;
export const ed25519 = (key: KeyObject | undefined, type: 'private' | 'public'): key is KeyObject =>
  !!key && key.asymmetricKeyType === 'ed25519' && (key.type === type || (type === 'public' && key.type === 'private'));
export function assertSigner(signer: SigningKey): void {
  if (!signer || !liveKeyId(signer.kid) || !ed25519(signer.key, 'private')) throw new TypeError('Signer must be an Ed25519 private key with a valid kid');
}
