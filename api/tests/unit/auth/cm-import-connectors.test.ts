import { describe, expect, it } from 'vitest';
import { encryptSecret } from '../../../src/services/secret-crypto';
import { isRecoverableLegacyConnectorCapability } from '../../../src/services/identity/cm-import-connectors';
import { readSourceConnectorCapability } from '../../../src/services/identity/cm-connector-custody-values';

describe('historical connector debt classification', () => {
  it.each([null, '', 'lost-key-fixture', 'v99:unknown-envelope'])(
    'keeps an absent or unreadable historical capability unresolved: %s', secret => {
      expect(isRecoverableLegacyConnectorCapability(secret)).toBe(false);
    });

  it.each([{ refreshToken: 'synthetic-refresh' }, { accessToken: 'synthetic-access' }])(
    'recognizes a capability through the real source secret custodian', value => {
      const encrypted = encryptSecret(JSON.stringify(value));
      expect(isRecoverableLegacyConnectorCapability(encrypted)).toBe(true);
    });

  it.each([{}, [], { refreshToken: 42 }, { refreshToken: '', accessToken: '' }])(
    'never treats decryptable but unusable material as a completed revocation', value => {
      const encrypted = encryptSecret(JSON.stringify(value));
      expect(isRecoverableLegacyConnectorCapability(encrypted)).toBe(false);
      // The new-deletion reader still refuses; only historical accounting has unresolved disposition.
      expect(() => readSourceConnectorCapability(encrypted)).toThrow();
    });
});
