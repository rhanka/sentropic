import { describe, expect, it } from 'vitest';
import { a4Tier, requestSchema } from '../../../src/scripts/cm-preprod-contract';

const hash = 'b'.repeat(64);
const base = { operationId: 'a4-tier', candidateCommit: 'a'.repeat(40),
  candidateImage: `ghcr.io/rhanka/sentropic-api@sha256:${hash}`, backupTemplateSha256: hash,
  authorizationRef: 'track:approval', writerFenceRef: 'track:fence', rollbackCheckpointRef: 'track:rollback',
  rollbackLimitsRef: 'track:limits', sourceMetadataDispositionRef: 'track:metadata', remoteSnapshotRef: 'custody:remote',
  remoteSnapshotDigest: hash, legacyWritersStopped: true, remoteFileWriterStopped: true };
const preprod = { ...base, format: 'preprod-a4-request/1', namespace: 'sentropic-preprod',
  emailCodeActiveKeyRef: 'email-code-hmac:v1:preprod:15c2f8b66073655a' };
const prod = { ...base, format: 'prod-a4-request/1', namespace: 'sentropic',
  emailCodeActiveKeyRef: 'email-code-hmac:v1:prod:0123456789abcdef' };

describe('A4 operator request tiers', () => {
  it('should accept a request whose format, namespace and HMAC ring all name the same tier', () => {
    expect(requestSchema.parse(preprod).namespace).toBe('sentropic-preprod');
    expect(requestSchema.parse(prod).namespace).toBe('sentropic');
  });
  it('should bind each namespace to its own product verifier', () => {
    expect(a4Tier('sentropic-preprod')).toEqual({ tier: 'preprod', rpId: 'preprod.sentropic.sent-tech.ca',
      origin: 'https://preprod.sentropic.sent-tech.ca' });
    expect(a4Tier('sentropic')).toEqual({ tier: 'prod', rpId: 'sent-tech.ca', origin: 'https://sentropic.sent-tech.ca' });
  });
  for (const [name, request] of Object.entries({
    'prod format in the preprod namespace': { ...preprod, format: 'prod-a4-request/1' },
    'preprod namespace with a prod HMAC ring': { ...preprod, emailCodeActiveKeyRef: prod.emailCodeActiveKeyRef },
    'prod request with a preprod HMAC ring': { ...prod, emailCodeActiveKeyRef: preprod.emailCodeActiveKeyRef },
    'unknown namespace': { ...prod, namespace: 'sentropic-restore-a4' },
    'missing HMAC ring': { ...prod, emailCodeActiveKeyRef: undefined },
  })) {
    it(`should refuse a ${name}`, () => {
      expect(requestSchema.safeParse(request).success).toBe(false);
    });
  }
});
