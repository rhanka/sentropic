// A2.0b versioned amendment descriptors. The frozen 1.0 descriptor array is
// untouched; these rows name the additive custody bundle (1.1.0) and the
// atomic deletion contract (2.0.0).

export const IDENTITY_CUSTODY_CONTRACT_VERSION = '1.1.0' as const;
export const IDENTITY_ATOMIC_DELETION_CONTRACT_VERSION = '2.0.0' as const;

export type IdentityAmendmentDomainV1 =
  | 'account_authentication_profile'
  | 'webauthn_custody'
  | 'single_use_proofs'
  | 'digest_invitations'
  | 'bound_login_sessions'
  | 'social_subjects'
  | 'identity_import'
  | 'transaction_binding'
  | 'atomic_person_deletion';

export interface IdentityAmendmentDescriptorV1 {
  readonly domain: IdentityAmendmentDomainV1;
  readonly version: '1.1.0' | '2.0.0';
  readonly baseContractVersion: '1.0.0';
  readonly amendment: 'A2.0b';
  readonly status: 'contract-only';
  readonly profiles: readonly ['postgres', 'sqlite'];
  readonly records: readonly string[];
  readonly ports: readonly string[];
  readonly factories: readonly string[];
  readonly errorType: 'IdentityCustodyErrorV1';
}

const descriptor = (
  domain: IdentityAmendmentDomainV1,
  version: '1.1.0' | '2.0.0',
  records: readonly string[],
  ports: readonly string[],
  factories: readonly string[] = [],
): IdentityAmendmentDescriptorV1 => ({
  domain,
  version,
  baseContractVersion: '1.0.0',
  amendment: 'A2.0b',
  status: 'contract-only',
  profiles: ['postgres', 'sqlite'],
  records,
  ports,
  factories,
  errorType: 'IdentityCustodyErrorV1',
});

export const IDENTITY_A20B_DESCRIPTORS: readonly IdentityAmendmentDescriptorV1[] = [
  descriptor(
    'account_authentication_profile',
    '1.1.0',
    ['IdentityAccountProfileV1'],
    ['IdentityAccountProfileStoreV1'],
  ),
  descriptor(
    'webauthn_custody',
    '1.1.0',
    ['WebAuthnCredentialV1'],
    ['WebAuthnCredentialStoreV1'],
  ),
  descriptor(
    'single_use_proofs',
    '1.1.0',
    [
      'IdentityDigestV1',
      'SingleUseProofKindV1',
      'SingleUseProofKeyV1',
      'SingleUseProofBaseV1',
      'WebAuthnChallengeV1',
      'EmailCodeProofV1',
      'MagicLinkProofV1',
      'SingleUseProofV1',
      'SingleUseProofMatchV1',
      'EmailRegistrationTicketV1',
      'IdentityEmailCodeKeyRingV1',
    ],
    [
      'SingleUseProofStoreV1',
      'EmailRegistrationTicketStoreV1',
      'IdentityDigestPortV1',
      'IdentityEmailCodeKeyRingPortV1',
    ],
  ),
  descriptor(
    'digest_invitations',
    '1.1.0',
    ['DigestInvitationV1', 'IssuedDigestInvitationV1'],
    ['DigestInvitationStoreV1', 'IdentityDigestPortV1'],
  ),
  descriptor(
    'bound_login_sessions',
    '1.1.0',
    ['BoundLoginSessionV1', 'SignedLoginBindingV1'],
    ['BoundLoginSessionStoreV1', 'IdentityLoginTokenPortV1'],
  ),
  descriptor(
    'social_subjects',
    '1.1.0',
    ['SocialIdentityV1'],
    ['SocialIdentityStoreV1'],
  ),
  descriptor(
    'identity_import',
    '1.1.0',
    [
      'IdentityImportRowV1',
      'IdentityImportBatchV1',
      'IdentityImportIssueReferenceV1',
      'IdentityImportValidationV1',
      'IdentityImportReceiptV1',
    ],
    ['IdentityCustodyImportPortV1', 'IdentityImportFencePortV1'],
    ['createIdentityCustodyImporterV1'],
  ),
  descriptor(
    'transaction_binding',
    '1.1.0',
    [
      'IdentityIsoTimeV1',
      'IdentitySha256HexV1',
      'IdentityBase64UrlV1',
      'IdentityRevisionV1',
      'IdentityStorageProfileV1',
      'IdentityTransactionV1',
      'IdentityRunOptionsV1',
      'IdentityCustodyStoresV1',
      'IdentityCustodyErrorCodeV1',
    ],
    ['IdentityUnitOfWorkV1'],
    ['createPostgresIdentityUnitOfWorkV1', 'createSqliteIdentityUnitOfWorkV1'],
  ),
  descriptor(
    'atomic_person_deletion',
    '2.0.0',
    [
      'BusinessDeletionHandlerIdV1',
      'PersonDeletionCommandV2',
      'BusinessDeletionPlanV1',
      'BusinessDeletionReceiptV1',
      'AtomicRevocationStepOutcomeV2',
      'AtomicRevocationStepReceiptV2',
      'PersonDeletionReceiptV2',
      'IdentityDeletionOperationV2',
      'IdentityDeletionAttemptV2',
    ],
    ['AtomicPersonDeletionV2', 'BusinessDeletionPortV1'],
    ['createAtomicPersonDeletionV2'],
  ),
];

export const identityAmendmentDescriptorV1 = (
  domain: IdentityAmendmentDomainV1,
): IdentityAmendmentDescriptorV1 | undefined =>
  IDENTITY_A20B_DESCRIPTORS.find((entry) => entry.domain === domain);
