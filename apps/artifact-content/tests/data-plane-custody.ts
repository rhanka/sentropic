import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CustodyGuard, type CustodyToken } from '../../sandbox-node/src/custody';
import type { CustodyLease } from '../src/data-plane';

/** Main has no signed custody verifier yet; mirror the compact EdDSA contract and use its real epoch/stream guard. */
export function fixtureCustody() {
  const keys = generateKeyPairSync('ed25519');
  const directory = mkdtempSync(join(tmpdir(), 'content-custody-'));
  const guard = new CustodyGuard(join(directory, 'custody.wal'));
  return {
    guard,
    sign(lease: CustodyLease) {
      const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ tenantId: lease.tenantId, principalId: lease.principalId,
        custodyEpoch: lease.custodyEpoch, resourceId: lease.physicalUid,
        issuedAt: lease.issuedAt, deadlineAt: lease.deadlineAt })).toString('base64url');
      const input = `${header}.${payload}`;
      return `${input}.${sign(null, Buffer.from(input), keys.privateKey).toString('base64url')}`;
    },
    verify(token: string, tenant: 'sentropic' | 'immo', uid: string): CustodyToken {
      if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('invalid JWS');
      const [header, payload, signature] = token.split('.');
      const metadata = JSON.parse(Buffer.from(header, 'base64url').toString());
      if (metadata.alg !== 'EdDSA' || metadata.crit || metadata.b64 === false
        || !verify(null, Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))) {
        throw new Error('invalid JWS');
      }
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (typeof claims.principalId !== 'string' || !claims.principalId
        || Object.keys(claims).sort().join(',') !== 'custodyEpoch,deadlineAt,issuedAt,principalId,resourceId,tenantId') {
        throw new Error('invalid claims');
      }
      guard.authorize(claims, tenant, uid, false);
      return claims;
    },
    close() { rmSync(directory, { recursive: true, force: true }); },
  };
}
