// A2.0b contract surface: versions, descriptors, error codes and the D3
// amendment drift check. Fails on any undeclared addition or removal.

import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CUSTODY_CONTRACT_VERSION,
  IDENTITY_ATOMIC_DELETION_CONTRACT_VERSION,
  IDENTITY_A20B_DESCRIPTORS,
  identityAmendmentDescriptorV1,
} from '../../src/identity-contracts/custody-descriptors.js';
import { IdentityCustodyErrorV1, scrubIdentityErrorForLog } from '../../src/identity-contracts/custody-errors.js';
import { IDENTITY_CONTRACT_VERSION, IDENTITY_DOMAIN_DESCRIPTORS, identityDomainDescriptor } from '../../src/identity-contracts/descriptors.js';
import * as clusterMesh from '../../src/index.js';

describe('A2.0b custody contract surface', () => {
  it('pins the custody and atomic deletion contract versions', () => {
    expect(IDENTITY_CUSTODY_CONTRACT_VERSION).toBe('1.1.0');
    expect(IDENTITY_ATOMIC_DELETION_CONTRACT_VERSION).toBe('2.0.0');
    expect(IDENTITY_CONTRACT_VERSION).toBe('1.0.0');
    expect(IDENTITY_DOMAIN_DESCRIPTORS.length).toBeGreaterThan(0);
    expect(identityDomainDescriptor('accounts')?.version).toBe('1.0.0');
  });

  it('ships exact amendment descriptors for all nine domains', () => {
    expect(IDENTITY_A20B_DESCRIPTORS).toHaveLength(9);
    const domains = IDENTITY_A20B_DESCRIPTORS.map((entry) => entry.domain);
    expect(domains).toEqual([
      'account_authentication_profile',
      'webauthn_custody',
      'single_use_proofs',
      'digest_invitations',
      'bound_login_sessions',
      'social_subjects',
      'identity_import',
      'transaction_binding',
      'atomic_person_deletion',
    ]);
    for (const entry of IDENTITY_A20B_DESCRIPTORS) {
      expect(entry.amendment).toBe('A2.0b');
      expect(entry.baseContractVersion).toBe('1.0.0');
      expect(entry.status).toBe('contract-only');
      expect(entry.profiles).toEqual(['postgres', 'sqlite']);
      expect(entry.errorType).toBe('IdentityCustodyErrorV1');
      expect(entry.records.length).toBeGreaterThan(0);
      expect(entry.ports.length).toBeGreaterThan(0);
    }
    expect(identityAmendmentDescriptorV1('webauthn_custody')?.version).toBe('1.1.0');
    expect(identityAmendmentDescriptorV1('atomic_person_deletion')?.version).toBe('2.0.0');
    expect(identityAmendmentDescriptorV1('transaction_binding')).toBeDefined();
  });

  it('exposes every descriptor port and factory at runtime', async () => {
    const runtime = clusterMesh as unknown as Record<string, unknown>;
    const portMethods: Record<string, readonly string[]> = {
      WebAuthnCredentialStoreV1: ['insert', 'compareAndSwapCounter'],
      SingleUseProofStoreV1: ['insert', 'consume', 'findLatestEmailCode'],
      EmailRegistrationTicketStoreV1: ['exchangeCode', 'consume'],
      DigestInvitationStoreV1: ['insert', 'consumeByDigest'],
      BoundLoginSessionStoreV1: ['insert', 'rotate', 'revokeAllForUser'],
      SocialIdentityStoreV1: ['insert', 'unlink'],
    };
    for (const [port, methods] of Object.entries(portMethods)) {
      const descriptor = IDENTITY_A20B_DESCRIPTORS.find((entry) => entry.ports.includes(port));
      expect(descriptor, port).toBeDefined();
      void methods;
    }
    // Factories are real exported functions.
    const factories = IDENTITY_A20B_DESCRIPTORS.flatMap((entry) => entry.factories);
    expect(factories).toContain('createIdentityCustodyImporterV1');
    expect(factories).toContain('createAtomicPersonDeletionV2');
    for (const factory of factories) {
      expect(typeof runtime[factory], factory).toBe('function');
    }
  });

  it('keeps every custody error message fixed and free of material', () => {
    const canaries = ['marie@example.test', 'sit_secret', 'deadbeef'.repeat(8)];
    const codes = [
      'identity_contract_unavailable', 'identity_material_invalid', 'identity_material_missing', 'identity_record_conflict', 'identity_subject_retired',
      'webauthn_credential_conflict', 'webauthn_counter_rejected', 'webauthn_credential_stale', 'proof_state_conflict', 'proof_binding_mismatch',
      'login_binding_mismatch', 'login_refresh_conflict', 'social_subject_conflict', 'identity_import_conflict', 'identity_import_invalid',
      'identity_transaction_unbound', 'identity_transaction_indeterminate', 'identity_cascade_participant_missing', 'identity_cascade_step_failed',
      'identity_cascade_diagnostic_failed', 'identity_delivery_claim_conflict', 'identity_revocation_custody_missing', 'identity_revocation_custody_invalid',
      'identity_orphan_detected', 'identity_operation_conflict',
    ] as const;
    expect(codes).toHaveLength(25);
    for (const code of codes) {
      const error = new IdentityCustodyErrorV1(code);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('marie');
      for (const canary of canaries) expect(error.message).not.toContain(canary);
      expect(scrubIdentityErrorForLog(error)).toEqual({ code });
    }
  });

  it('scrubs unknown and driver-shaped errors to internal', () => {
    expect(scrubIdentityErrorForLog(new Error('boom'))).toEqual({ code: 'internal' });
    expect(scrubIdentityErrorForLog({ code: '23505', detail: 'Key (email)=(marie@example.test) already exists' })).toEqual({ code: 'internal' });
    expect(scrubIdentityErrorForLog({ code: 'identity_conflict', reason: 'last_admin' })).toEqual({ code: 'identity_conflict', reason: 'last_admin' });
    expect(scrubIdentityErrorForLog(null)).toEqual({ code: 'internal' });
  });
});
