import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { generateTicketKeyPair } from '../src/tickets.js';
import { custodyVerificationKey } from '../src/custody-key.js';

describe('custody verification configuration', () => {
  it('should require a distinct Ed25519 verification authority', () => {
    const execution = generateTicketKeyPair(), custody = generateTicketKeyPair();
    expect(custodyVerificationKey(custody.publicKeyPem, execution.publicKeyPem).asymmetricKeyType).toBe('ed25519');
    expect(() => custodyVerificationKey(execution.publicKeyPem, execution.publicKeyPem)).toThrow('distinct');
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' });
    expect(() => custodyVerificationKey(ec, execution.publicKeyPem)).toThrow('Ed25519');
  });
});
