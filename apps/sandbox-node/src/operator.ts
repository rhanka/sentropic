import { createPublicKey, verify } from 'node:crypto';
import { ExecutionNodeError } from './errors.js';

export type OperatorOperation = 'drain' | 'undrain' | 'status';

/** Compact JWS, NumericDate seconds; epoch changes invalidate tickets across restart. */
export class OperatorGuard {
  private readonly seen = new Map<string, number>();
  constructor(private readonly keys: readonly string[], private readonly instance: string,
    private readonly epoch: number, private readonly now = () => Math.floor(Date.now() / 1000)) {
    if (keys.length < 1 || keys.length > 2 || keys.some(key => createPublicKey(key).asymmetricKeyType !== 'ed25519')) {
      throw new Error('one or two Ed25519 operator public keys required');
    }
  }

  authorize(token: string | undefined, op: OperatorOperation): void {
    try {
      if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const [header, payload, signature] = token.split('.') as [string, string, string];
      const metadata = JSON.parse(Buffer.from(header, 'base64url').toString());
      if (metadata.alg !== 'EdDSA' || metadata.crit || metadata.b64 === false) throw new Error();
      const bytes = Buffer.from(`${header}.${payload}`);
      if (!this.keys.some(key => verify(null, bytes, key, Buffer.from(signature, 'base64url')))) throw new Error();
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const now = this.now();
      if (claims.op !== op || claims.nodeInstanceId !== this.instance || claims.nodeEpoch !== this.epoch
        || claims.aud !== 'execution-node' || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
        || claims.exp <= now || claims.iat > now || claims.exp <= claims.iat || claims.exp - claims.iat > 60
        || typeof claims.jti !== 'string' || !claims.jti || claims.jti.length > 128) throw new Error();
      for (const [id, exp] of this.seen) if (exp <= now) this.seen.delete(id);
      if (this.seen.has(claims.jti) || this.seen.size >= 4096) throw new Error();
      this.seen.set(claims.jti, claims.exp);
    } catch { throw new ExecutionNodeError('custody_revoked', 'invalid or replayed operator ticket'); }
  }
}
