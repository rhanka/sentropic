import { beforeEach, describe, expect, it, vi } from 'vitest';

const configuration = vi.hoisted(() => ({ SECRET_ENCRYPTION_KEY: undefined as string | undefined }));
vi.mock('../../../src/config/env', () => ({ env: configuration }));
vi.mock('../../../src/logger', () => ({ logger: { warn: vi.fn() } }));
import { decryptSecret, encryptSecret, withConnectorRevocationKey } from '../../../src/services/secret-crypto';
import { readConnectorCapability, sealConnectorCapability } from '../../../src/services/identity/cm-connector-envelope';

const tuple = { custodyRef: 'custody', deliveryId: 'delivery', connectorAccountId: 'connector',
  provider: 'google_drive', keyRef: 'secret-crypto:v1' };
beforeEach(() => { configuration.SECRET_ENCRYPTION_KEY = undefined; });

describe('A4 production connector custody envelope', () => {
  it.each([undefined, ''])('should retain the actual source v1 semantics with optional configuration %s', setting => {
    const source = encryptSecret('synthetic source capability');
    configuration.SECRET_ENCRYPTION_KEY = setting;
    const plaintext = Buffer.from(JSON.stringify({ tokenKind: 'refresh', token: decryptSecret(source) }));
    try {
      const envelope = sealConnectorCapability(tuple, plaintext, '2026-11-01T00:00:00.000Z');
      expect(readConnectorCapability(envelope, bytes => JSON.parse(bytes.toString())))
        .toEqual({ tokenKind: 'refresh', token: 'synthetic source capability' });
      expect(decryptSecret(source)).toBe('synthetic source capability');
      expect(JSON.stringify(envelope)).not.toContain('synthetic source capability');
    } finally { plaintext.fill(0); }
  });

  it('should authenticate every custody tuple field and reject a corrupted ciphertext', () => {
    const plaintext = Buffer.from('{"tokenKind":"access","token":"synthetic"}');
    try {
      const envelope = sealConnectorCapability(tuple, plaintext, '2026-11-01T00:00:00.000Z');
      for (const key of ['custodyRef', 'deliveryId', 'connectorAccountId', 'provider', 'keyRef'] as const) {
        expect(() => readConnectorCapability({ ...envelope, [key]: 'changed' }, () => undefined))
          .toThrow('identity_revocation_custody_invalid');
      }
      expect(() => readConnectorCapability({ ...envelope, ciphertext: 'AA' }, () => undefined))
        .toThrow('identity_revocation_custody_invalid');
      expect(sealConnectorCapability(tuple, plaintext, envelope.createdAt).nonce).not.toBe(envelope.nonce);
    } finally { plaintext.fill(0); }
  });

  it('should clear borrowed plaintext and derived key buffers on both success and failure', () => {
    const plaintext = Buffer.from('{"tokenKind":"access","token":"synthetic"}');
    let borrowed: Buffer | undefined, derived: Buffer | undefined;
    try {
      const envelope = sealConnectorCapability(tuple, plaintext, '2026-11-01T00:00:00.000Z');
      expect(() => readConnectorCapability(envelope, bytes => { borrowed = bytes; throw new Error('synthetic failure'); }))
        .toThrow('identity_revocation_custody_invalid');
      withConnectorRevocationKey(tuple.keyRef, key => { derived = key; });
      expect(borrowed?.every(byte => byte === 0)).toBe(true);
      expect(derived?.every(byte => byte === 0)).toBe(true);
    } finally { plaintext.fill(0); }
  });
});
