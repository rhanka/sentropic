import { verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { RemoteAuthorityError, remoteCliBodySchema, remoteCliProofSchema,
  remoteSignedBytes, requireRemoteDeadline, requireRemoteVersion } from './remote-contract';
import { remoteCanonicalJson } from './remote-json';

// Supplied by the current approved-source/managed-session port, never from the proof body.
export type RemoteNativeProofState = z.infer<typeof remoteCliBodySchema> & { key: KeyObject; now: number; revoked?: boolean };
export function verifyRemoteCliProof(input: unknown, current: RemoteNativeProofState) {
  const wrapper = z.object({ body: z.unknown() }).passthrough().safeParse(input);
  if (wrapper.success) requireRemoteVersion(wrapper.data.body);
  const parsed = remoteCliProofSchema.safeParse(input);
  if (!parsed.success) throw new RemoteAuthorityError('session_proof_invalid');
  const proof = parsed.data;
  if (current.revoked || current.key.type !== 'public' || current.key.asymmetricKeyType !== 'ed25519'
    || proof.body.issuer !== current.issuer || proof.body.kid !== current.kid
    || !verify(null, remoteSignedBytes(proof.body), current.key, Buffer.from(proof.signature.value, 'base64url')))
    throw new RemoteAuthorityError('authority_refused');
  requireRemoteDeadline(proof.body.issuedAt, proof.body.expiresAt, current.now);
  // current also contains trusted local key/clock fields; construct only the closed signed fields.
  const { key: _key, now: _now, revoked: _revoked, ...body } = current;
  void _key; void _now; void _revoked;
  if (remoteCanonicalJson(proof.body) !== remoteCanonicalJson(remoteCliBodySchema.parse(body)))
    throw new RemoteAuthorityError('session_proof_invalid');
  return proof;
}
