import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { RemoteAuthorityError, remoteId, remoteRawHash } from './remote-contract';

export type RemoteSignerRole = 'idp' | 'attestation' | 'mesh';
export interface RemoteKeyPin {
  issuer: string; kid: string; workload: string; secretRef: string; publicKeyPem: string;
  revoked?: boolean;
}
export type RemoteTrust = Record<RemoteSignerRole, RemoteKeyPin>;
const roles: RemoteSignerRole[] = ['idp', 'attestation', 'mesh'];
const fingerprint = (key: KeyObject): string => remoteRawHash(key.export({ type: 'spki', format: 'der' }));

export function validateRemoteTrust(trust: RemoteTrust): void {
  try {
    const fingerprints: string[] = [];
    for (const role of roles) {
      const pin = trust[role];
      if (!pin || pin.revoked || !pin.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')
        || ![pin.issuer, pin.kid, pin.workload].every((id) => remoteId.safeParse(id).success)
        || !pin.secretRef || pin.secretRef.length > 512) throw new Error();
      const key = createPublicKey(pin.publicKeyPem);
      if (key.asymmetricKeyType !== 'ed25519') throw new Error();
      fingerprints.push(fingerprint(key));
    }
    if (new Set(fingerprints).size !== 3) throw new Error();
    for (const field of ['kid', 'workload', 'secretRef'] as const) {
      if (new Set(roles.map((role) => trust[role][field])).size !== 3) throw new Error();
    }
  } catch {
    throw new RemoteAuthorityError('authority_unavailable');
  }
}

export function loadRemoteSigner(trust: RemoteTrust, role: RemoteSignerRole, workload: string,
  readSecret: (ref: string) => string): { issuer: string; kid: string; key: KeyObject } {
  validateRemoteTrust(trust);
  const pin = trust[role];
  if (pin.workload !== workload) throw new RemoteAuthorityError('authority_refused');
  try {
    // Only this role's secret is requested. Public trust contains no private bytes.
    const key = createPrivateKey(readSecret(pin.secretRef));
    if (key.asymmetricKeyType !== 'ed25519'
      || fingerprint(createPublicKey(key)) !== fingerprint(createPublicKey(pin.publicKeyPem))) throw new Error();
    return { issuer: pin.issuer, kid: pin.kid, key };
  } catch {
    throw new RemoteAuthorityError('authority_unavailable');
  }
}
