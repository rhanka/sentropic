import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { SecretEnvelopeError, withConnectorRevocationKey } from '../secret-crypto';

export interface ConnectorCustodyTuple {
  custodyRef: string; deliveryId: string; connectorAccountId: string; provider: string; keyRef: string;
}
export interface ConnectorCustodyEnvelope extends ConnectorCustodyTuple {
  envelopeVersion: '1'; nonce: string; ciphertext: string; authTag: string; createdAt: string;
}
const invalid = (): never => { throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid'); };
const aad = (tuple: ConnectorCustodyTuple): Buffer => {
  if ([tuple.custodyRef, tuple.deliveryId, tuple.connectorAccountId, tuple.provider, tuple.keyRef]
    .some(value => typeof value !== 'string' || !value.length || value.length > 256)
    || !/^secret-crypto:v\d+$/.test(tuple.keyRef)) return invalid();
  return Buffer.from(JSON.stringify(['A2.0b-connector-custody', '1', tuple.custodyRef, tuple.deliveryId,
    tuple.connectorAccountId, tuple.provider, tuple.keyRef]));
};
const borrowKey = <T>(keyRef: string, operation: (key: Buffer) => T): T => {
  try { return withConnectorRevocationKey(keyRef, operation); }
  catch (error) {
    if (error instanceof SecretEnvelopeError) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
    throw error;
  }
};
const decode = (text: string, length?: number): Buffer => {
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.toString('base64url') !== text || !bytes.length || bytes.length > 16384 || (length !== undefined && bytes.length !== length)) {
    bytes.fill(0); return invalid();
  }
  return bytes;
};

export function sealConnectorCapability(tuple: ConnectorCustodyTuple, capability: Uint8Array, createdAt: string): ConnectorCustodyEnvelope {
  const nonce = randomBytes(12), associated = aad(tuple);
  let first: Buffer | undefined, last: Buffer | undefined, ciphertext: Buffer | undefined, tag: Buffer | undefined;
  try {
    if (!capability.length || capability.length > 16384) return invalid();
    return borrowKey(tuple.keyRef, key => {
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
      cipher.setAAD(associated);
      first = cipher.update(capability); last = cipher.final();
      ciphertext = Buffer.concat([first, last]); tag = cipher.getAuthTag();
      return { ...tuple, envelopeVersion: '1', nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'), authTag: tag.toString('base64url'), createdAt };
    });
  } finally { nonce.fill(0); associated.fill(0); first?.fill(0); last?.fill(0); ciphertext?.fill(0); tag?.fill(0); }
}

/** The borrowed plaintext exists only during this synchronous callback. */
export function readConnectorCapability<T>(envelope: ConnectorCustodyEnvelope, operation: (bytes: Buffer) => T): T {
  const owned: Buffer[] = [];
  const take = (bytes: Buffer) => { owned.push(bytes); return bytes; };
  try {
    if (envelope.envelopeVersion !== '1') return invalid();
    const nonce = take(decode(envelope.nonce, 12)), tag = take(decode(envelope.authTag, 16));
    const ciphertext = take(decode(envelope.ciphertext)), associated = take(aad(envelope));
    return borrowKey(envelope.keyRef, key => {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
      decipher.setAAD(associated); decipher.setAuthTag(tag);
      const first = take(decipher.update(ciphertext)), last = take(decipher.final());
      return operation(take(Buffer.concat([first, last])));
    });
  } catch (error) {
    if (error instanceof IdentityCustodyErrorV1) throw error;
    return invalid();
  } finally { for (const buffer of owned) buffer.fill(0); }
}
