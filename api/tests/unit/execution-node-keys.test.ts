import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { executionNodeConfig } from '../../src/services/artifacts/live/execution-node-transport';

describe('execution node custody signing configuration', () => {
  it('should refuse a missing or reused custody key and accept an independent pair', () => {
    const keys = generateKeyPairSync('ed25519'), custody = generateKeyPairSync('ed25519');
    const encode = (key: typeof keys.privateKey) => Buffer.from(key.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    const env = { ARTIFACT_EXECUTION_NODE_URL: 'https://node.test', ARTIFACT_EXECUTION_NODE_ID: 'node',
      ARTIFACT_EXECUTION_NODE_INSTANCE_ID: 'instance', ARTIFACT_EXECUTION_NODE_EPOCH: '1',
      ARTIFACT_EXECUTION_NODE_PROVENANCE_PUBLIC_KEY_B64: Buffer.from(keys.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
      ARTIFACT_EXECUTION_TICKET_ED25519_KEY_B64: encode(keys.privateKey),
      SANDBOX_MTLS_CA_CERT_B64: 'synthetic', SANDBOX_MTLS_CONTROL_PLANE_CERT_B64: 'synthetic', SANDBOX_MTLS_CONTROL_PLANE_KEY_B64: 'synthetic' };
    expect(() => executionNodeConfig(env)).toThrow('ARTIFACT_CUSTODY_ED25519_KEY_B64');
    expect(() => executionNodeConfig({ ...env, ARTIFACT_CUSTODY_ED25519_KEY_B64: encode(keys.privateKey) })).toThrow('ARTIFACT_CUSTODY_ED25519_KEY_B64');
    expect(executionNodeConfig({ ...env, ARTIFACT_CUSTODY_ED25519_KEY_B64: encode(custody.privateKey) }).custodyKey.asymmetricKeyType).toBe('ed25519');
  });
});
