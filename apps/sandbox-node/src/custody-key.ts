import { createPublicKey, type KeyObject } from 'node:crypto';

/** Custody and execution tickets are independent authorities, even when both use Ed25519. */
export function custodyVerificationKey(custodyPem: string | Buffer, executionPem: string | Buffer): KeyObject {
  const custody = createPublicKey(custodyPem), execution = createPublicKey(executionPem);
  if (custody.asymmetricKeyType !== 'ed25519' || execution.asymmetricKeyType !== 'ed25519'
    || custody.export({ type: 'spki', format: 'der' }).equals(execution.export({ type: 'spki', format: 'der' }))) {
    throw new Error('distinct Ed25519 custody and execution verification keys required');
  }
  return custody;
}
