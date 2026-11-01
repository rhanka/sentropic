// A2.0b custody extension bundle (1.1.0) and atomic deletion contract (2.0.0).
// Additive only: every frozen 1.0 export keeps its meaning. New records use an
// explicit `T | null` encoding for nullable columns (SQL NULL); inherited
// optional 1.0 fields are untouched.

export type IdentityIsoTimeV1 = string;
export type IdentitySha256HexV1 = string;
export type IdentityBase64UrlV1 = string;
export type IdentityRevisionV1 = number;
export type IdentityStorageProfileV1 = 'postgres' | 'sqlite';

export type IdentityDigestV1 =
  | { readonly algorithm: 'sha256'; readonly value: IdentitySha256HexV1 }
  | {
      readonly algorithm: 'hmac-sha256';
      readonly value: IdentitySha256HexV1;
      readonly keyRef: string;
    };

/** Canonical binding key: exactly ECMAScript `email.trim().toLowerCase()`. */
export const canonicalBindingEmailV1 = (email: string): string => email.trim().toLowerCase();

export interface IdentityAccountProfileV1 {
  readonly userId: string;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly approvalDueAt: IdentityIsoTimeV1 | null;
  readonly approvedAt: IdentityIsoTimeV1 | null;
  readonly approvedByUserId: string | null;
  readonly disabledAt: IdentityIsoTimeV1 | null;
  readonly disabledReason: string | null;
  readonly legacyAccountStatus: string | null;
}

export interface WebAuthnCredentialV1 {
  readonly proofId: string;
  readonly userId: string;
  readonly credentialId: IdentityBase64UrlV1;
  readonly publicKeyCose: IdentityBase64UrlV1;
  readonly counter: number;
  readonly revision: IdentityRevisionV1;
  readonly rpId: string;
  readonly deviceName: string | null;
  readonly transports: readonly string[] | null;
  readonly uv: boolean;
  readonly deviceType: string | null;
  readonly backedUp: boolean | null;
  readonly createdAt: IdentityIsoTimeV1;
  readonly lastUsedAt: IdentityIsoTimeV1 | null;
  readonly revokedAt: IdentityIsoTimeV1 | null;
}

export type SingleUseProofKindV1 = 'webauthn_challenge' | 'email_code' | 'magic_link';

export interface SingleUseProofKeyV1 {
  readonly kind: SingleUseProofKindV1;
  readonly proofId: string;
}

export interface SingleUseProofBaseV1 {
  readonly proofId: string;
  readonly userId: string | null;
  readonly state: 'pending' | 'consumed' | 'revoked';
  readonly revision: IdentityRevisionV1;
  readonly createdAt: IdentityIsoTimeV1;
  readonly expiresAt: IdentityIsoTimeV1;
  readonly consumedAt: IdentityIsoTimeV1 | null;
  readonly revokedAt: IdentityIsoTimeV1 | null;
}

export interface WebAuthnChallengeV1 extends SingleUseProofBaseV1 {
  readonly kind: 'webauthn_challenge';
  readonly challenge: IdentityBase64UrlV1;
  readonly purpose: 'registration' | 'authentication';
  readonly rpId: string;
  readonly allowedOrigins: readonly string[];
  readonly userVerification: 'required' | 'preferred' | 'discouraged';
}

export interface EmailCodeProofV1 extends SingleUseProofBaseV1 {
  readonly kind: 'email_code';
  readonly email: string;
  readonly codeDigest: IdentityDigestV1;
}

export interface MagicLinkProofV1 extends SingleUseProofBaseV1 {
  readonly kind: 'magic_link';
  readonly email: string;
  readonly tokenHash: IdentitySha256HexV1;
}

export type SingleUseProofV1 = WebAuthnChallengeV1 | EmailCodeProofV1 | MagicLinkProofV1;

// A verified email code and its registration continuation are two lifecycles.
export interface EmailRegistrationTicketV1 {
  readonly codeProofId: string;
  readonly email: string;
  readonly tokenHash: IdentitySha256HexV1;
  readonly userId: string | null;
  readonly state: 'pending' | 'consumed' | 'revoked';
  readonly revision: IdentityRevisionV1;
  readonly createdAt: IdentityIsoTimeV1;
  readonly expiresAt: IdentityIsoTimeV1;
  readonly consumedAt: IdentityIsoTimeV1 | null;
  readonly revokedAt: IdentityIsoTimeV1 | null;
}

export interface DigestInvitationV1 {
  readonly invitationId: string;
  readonly email: string;
  readonly tenantId: string | null;
  readonly workspaceId: string | null;
  readonly clientId: string | null;
  readonly tokenHash: IdentitySha256HexV1;
  readonly status: 'pending' | 'consumed' | 'revoked';
  readonly expiresAt: IdentityIsoTimeV1;
  readonly createdAt: IdentityIsoTimeV1 | null;
  readonly consumedAt: IdentityIsoTimeV1 | null;
  readonly consumedByUserId: string | null;
  readonly revision: IdentityRevisionV1;
}

export interface IssuedDigestInvitationV1 {
  readonly invitation: DigestInvitationV1;
  // Returned once at issuance; never persisted.
  readonly token: string;
}

export interface SignedLoginBindingV1 {
  readonly mfaVerified: boolean;
  readonly authTime: number;
  readonly sessionVersion: number;
}

export interface BoundLoginSessionV1 {
  readonly sessionId: string;
  readonly userId: string;
  readonly sessionTokenHash: IdentitySha256HexV1;
  readonly refreshTokenHash: IdentitySha256HexV1 | null;
  readonly login: SignedLoginBindingV1;
  readonly rotationVersion: IdentityRevisionV1;
  readonly createdAt: IdentityIsoTimeV1;
  readonly expiresAt: IdentityIsoTimeV1;
  readonly revokedAt: IdentityIsoTimeV1 | null;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly lastActivityAt: IdentityIsoTimeV1 | null;
}

export interface SocialIdentityV1 {
  readonly proofId: string;
  readonly userId: string;
  readonly provider: string;
  readonly providerSubject: string;
  readonly providerTenant: string | null;
  readonly emailAtLink: string | null;
  readonly emailVerifiedByProvider: boolean;
  readonly linkedAt: IdentityIsoTimeV1;
  readonly lastLoginAt: IdentityIsoTimeV1 | null;
  readonly revokedAt: IdentityIsoTimeV1 | null;
  readonly revision: IdentityRevisionV1;
}

export interface IdentityAccountProfileStoreV1 {
  find(userId: string): Promise<IdentityAccountProfileV1 | null>;
  put(record: IdentityAccountProfileV1): Promise<void>;
}

export interface WebAuthnCredentialStoreV1 {
  insert(record: WebAuthnCredentialV1): Promise<void>;
  findById(proofId: string): Promise<WebAuthnCredentialV1 | null>;
  findByCredentialId(credentialId: string): Promise<WebAuthnCredentialV1 | null>;
  listForUser(userId: string): Promise<readonly WebAuthnCredentialV1[]>;
  compareAndSwapCounter(input: {
    readonly proofId: string;
    readonly userId: string;
    readonly expectedCounter: number;
    readonly expectedRevision: number;
    readonly newCounter: number;
    readonly at: string;
  }): Promise<WebAuthnCredentialV1>;
  rename(proofId: string, userId: string, deviceName: string): Promise<void>;
  revoke(proofId: string, userId: string, at: string): Promise<void>;
}

export type SingleUseProofMatchV1 =
  | {
      readonly kind: 'webauthn_challenge';
      readonly challenge: string;
      readonly purpose: 'registration' | 'authentication';
      readonly rpId: string;
    }
  | { readonly kind: 'email_code'; readonly email: string; readonly digest: IdentityDigestV1 }
  | { readonly kind: 'magic_link'; readonly email: string; readonly tokenHash: string };

export interface SingleUseProofStoreV1 {
  insert(record: SingleUseProofV1): Promise<void>;
  find(key: SingleUseProofKeyV1): Promise<SingleUseProofV1 | null>;
  findChallenge(challenge: string, purpose: WebAuthnChallengeV1['purpose']): Promise<WebAuthnChallengeV1 | null>;
  findLatestEmailCode(
    email: string,
    candidates: readonly IdentityDigestV1[],
    now: string,
  ): Promise<EmailCodeProofV1 | null>;
  findMagicLink(tokenHash: string): Promise<MagicLinkProofV1 | null>;
  countEmailCodes(email: string, since: string): Promise<number>;
  consume(input: {
    readonly key: SingleUseProofKeyV1;
    readonly expectedRevision: number;
    readonly expectedUserId: string | null;
    readonly match: SingleUseProofMatchV1;
    readonly bindUserId: string | null;
    readonly at: string;
  }): Promise<SingleUseProofV1>;
  revoke(key: SingleUseProofKeyV1, expectedRevision: number, at: string): Promise<void>;
  purgeExpired(now: string): Promise<number>;
}

export interface EmailRegistrationTicketStoreV1 {
  findByTokenHash(tokenHash: string): Promise<EmailRegistrationTicketV1 | null>;
  /** Create-only privileged import of a ticket row; no code consumption. */
  importTicket(record: EmailRegistrationTicketV1): Promise<void>;
  exchangeCode(input: {
    readonly codeProofId: string;
    readonly expectedRevision: number;
    readonly email: string;
    readonly digest: IdentityDigestV1;
    readonly ticket: EmailRegistrationTicketV1;
    readonly at: string;
  }): Promise<EmailRegistrationTicketV1>;
  consume(input: {
    readonly tokenHash: string;
    readonly email: string;
    readonly expectedRevision: number;
    readonly bindUserId: string;
    readonly at: string;
  }): Promise<EmailRegistrationTicketV1>;
  revoke(codeProofId: string, expectedRevision: number, at: string): Promise<void>;
}

export interface DigestInvitationStoreV1 {
  insert(record: DigestInvitationV1): Promise<void>;
  findById(invitationId: string): Promise<DigestInvitationV1 | null>;
  findByDigest(tokenHash: string): Promise<DigestInvitationV1 | null>;
  consumeByDigest(input: {
    readonly tokenHash: string;
    readonly email: string;
    readonly clientId: string | null;
    readonly userId: string;
    readonly expectedRevision: number;
    readonly at: string;
  }): Promise<DigestInvitationV1>;
  revoke(invitationId: string, expectedRevision: number, at: string): Promise<void>;
}

export interface BoundLoginSessionStoreV1 {
  insert(record: BoundLoginSessionV1): Promise<void>;
  findById(sessionId: string): Promise<BoundLoginSessionV1 | null>;
  findBySessionTokenHash(hash: string): Promise<BoundLoginSessionV1 | null>;
  findByRefreshTokenHash(hash: string): Promise<BoundLoginSessionV1 | null>;
  rotate(input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly expectedRefreshTokenHash: string;
    readonly expectedRotationVersion: number;
    readonly verifiedLogin: SignedLoginBindingV1;
    readonly nextSessionTokenHash: string;
    readonly nextRefreshTokenHash: string;
    readonly nextExpiresAt: string;
    readonly at: string;
  }): Promise<BoundLoginSessionV1>;
  touchActivity(sessionId: string, at: string): Promise<void>;
  revoke(sessionId: string, at: string): Promise<void>;
  revokeAllForUser(userId: string, at: string): Promise<number>;
  listForUser(userId: string): Promise<readonly BoundLoginSessionV1[]>;
}

export interface SocialIdentityStoreV1 {
  insert(record: SocialIdentityV1): Promise<void>;
  findById(proofId: string): Promise<SocialIdentityV1 | null>;
  findBySubject(provider: string, providerSubject: string): Promise<SocialIdentityV1 | null>;
  listForUser(userId: string): Promise<readonly SocialIdentityV1[]>;
  touchLogin(proofId: string, expectedRevision: number, at: string): Promise<void>;
  unlink(proofId: string, userId: string, expectedRevision: number, at: string): Promise<void>;
}

export interface IdentityCustodyStoresV1 {
  readonly profiles: IdentityAccountProfileStoreV1;
  readonly credentials: WebAuthnCredentialStoreV1;
  readonly singleUseProofs: SingleUseProofStoreV1;
  readonly emailTickets: EmailRegistrationTicketStoreV1;
  readonly invitations: DigestInvitationStoreV1;
  readonly sessions: BoundLoginSessionStoreV1;
  readonly social: SocialIdentityStoreV1;
}

// Implemented by the existing authentication/secret custodian, not a key table.
export interface IdentityDigestPortV1 {
  sha256(value: Uint8Array): Promise<IdentitySha256HexV1>;
  hmacSha256(keyRef: string, value: Uint8Array): Promise<IdentitySha256HexV1>;
  equal(left: Uint8Array, right: Uint8Array): boolean;
}

export interface IdentityEmailCodeKeyRingV1 {
  readonly issuance: 'hmac-sha256' | 'sha256';
  readonly activeKeyRef: string | null;
  readonly previousKeyRefs: readonly string[];
}

export interface IdentityEmailCodeKeyRingPortV1 {
  snapshot(): Promise<IdentityEmailCodeKeyRingV1>;
}

export interface IdentityEmailTicketClaimsV1 {
  readonly codeProofId: string;
  readonly email: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface IdentityEmailTicketTokenPortV1 {
  sign(claims: IdentityEmailTicketClaimsV1): Promise<string>;
  verify(token: Uint8Array, now: string): Promise<IdentityEmailTicketClaimsV1>;
  verifyForImport(token: Uint8Array): Promise<IdentityEmailTicketClaimsV1>;
}

export interface IdentityLoginTokenPortV1 {
  sign(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly tokenUse: 'session' | 'refresh';
    readonly login: SignedLoginBindingV1;
    readonly expiresAt: string;
  }): Promise<string>;
  verify(token: Uint8Array, expectedUse: 'session' | 'refresh', now: string): Promise<BoundLoginSessionV1>;
}

export interface IdentityRunOptionsV1 {
  readonly mode: 'read' | 'write' | 'import' | 'delete';
  readonly deadlineMs: number;
}

export interface IdentityTransactionV1<H> {
  readonly profile: IdentityStorageProfileV1;
  readonly transactionId: string;
  readonly readOnly: boolean;
  readonly hostTransaction: H;
  readonly stores: IdentityCustodyStoresV1;
}

export interface IdentityUnitOfWorkV1<H> {
  readonly profile: IdentityStorageProfileV1;
  runRead<T>(options: IdentityRunOptionsV1, operation: (tx: IdentityTransactionV1<H>) => Promise<T>): Promise<T>;
  runWrite<T>(options: IdentityRunOptionsV1, operation: (tx: IdentityTransactionV1<H>) => Promise<T>): Promise<T>;
}

export type IdentityImportRowV1 =
  | { readonly entity: 'account'; readonly record: import('./types.js').UserAccount; readonly profile: IdentityAccountProfileV1 }
  | { readonly entity: 'oauth_consent'; readonly record: import('./types.js').OAuthConsentRecord }
  | { readonly entity: 'credential'; readonly record: WebAuthnCredentialV1 }
  | { readonly entity: 'single_use_proof'; readonly record: SingleUseProofV1 }
  | { readonly entity: 'email_ticket'; readonly record: EmailRegistrationTicketV1 }
  | { readonly entity: 'invitation'; readonly record: DigestInvitationV1 }
  | { readonly entity: 'login_session'; readonly record: BoundLoginSessionV1 }
  | { readonly entity: 'social_link'; readonly record: SocialIdentityV1 }
  | { readonly entity: 'tenant'; readonly record: import('./types.js').TenantRecord }
  | { readonly entity: 'tenant_membership'; readonly record: import('./types.js').TenantMembershipRecord }
  | { readonly entity: 'workspace'; readonly record: import('./types.js').WorkspaceRecord }
  | { readonly entity: 'workspace_membership'; readonly record: import('./types.js').WorkspaceMembershipRecord };

export interface IdentityImportBatchV1 {
  readonly contractVersion: '1.1.0';
  readonly migrationId: string;
  readonly sourceSnapshotRef: string;
  readonly sourceSnapshotDigest: string;
  readonly manifestDigest: string;
  readonly importedAt: string;
  readonly rows: readonly IdentityImportRowV1[];
}

export interface IdentityImportIssueReferenceV1 {
  readonly rowIndex: number;
  readonly safeIdentity?: readonly string[];
}

export interface IdentityImportValidationV1 {
  readonly valid: boolean;
  readonly issues: readonly {
    readonly entity: IdentityImportRowV1['entity'];
    readonly code: 'identity_import_conflict' | 'identity_import_invalid';
    readonly count: number;
    readonly references: readonly IdentityImportIssueReferenceV1[];
  }[];
}

export interface IdentityImportReceiptV1 {
  readonly contractVersion: '1.1.0';
  readonly migrationId: string;
  readonly sourceSnapshotRef: string;
  readonly sourceSnapshotDigest: string;
  readonly manifestDigest: string;
  readonly importedAt: string;
  readonly counts: Readonly<Record<IdentityImportRowV1['entity'], number>>;
  readonly identitiesPreserved: true;
  readonly verificationMaterialPreserved: true;
  readonly lifecyclePreserved: true;
}

export interface IdentityImportFencePortV1 {
  assertExclusiveWriter(sourceSnapshotRef: string): Promise<void>;
}

export interface IdentityCustodyImportPortV1<H> {
  validate(batch: IdentityImportBatchV1): Promise<IdentityImportValidationV1>;
  importBatch(batch: IdentityImportBatchV1): Promise<IdentityImportReceiptV1>;
  importBatchInTransaction(batch: IdentityImportBatchV1, tx: IdentityTransactionV1<H>): Promise<IdentityImportReceiptV1>;
}

export interface IdentityCustodyImporterInput<H> {
  readonly unitOfWork: IdentityUnitOfWorkV1<H>;
  readonly fence: IdentityImportFencePortV1;
  readonly importOptions: IdentityRunOptionsV1;
  readonly validationOptions: IdentityRunOptionsV1;
}

export type BusinessDeletionHandlerIdV1 = 'self_account' | 'admin_account';

export interface BusinessDeletionPlanV1 {
  readonly userId: string;
  readonly workspaceIdsToDelete: readonly string[];
  readonly retainedWorkspaceIds: readonly string[];
}

export interface BusinessDeletionReceiptV1 {
  readonly handlerId: BusinessDeletionHandlerIdV1;
  readonly deletedRows: Readonly<Record<string, number>>;
}

/** Business participant bound to the exact active host transaction. */
export interface BusinessDeletionPortV1<H> {
  readonly handlerId: BusinessDeletionHandlerIdV1;
  deleteRows(plan: BusinessDeletionPlanV1, tx: H): Promise<BusinessDeletionReceiptV1>;
  assertNoOrphans(plan: BusinessDeletionPlanV1, tx: H): Promise<void>;
}

export type AtomicRevocationStepOutcomeV2 = 'applied' | 'rolled_back' | 'queued' | 'not_applicable';

export interface AtomicRevocationStepReceiptV2 {
  readonly step: import('./types.js').RevocationStepKind;
  readonly outcome: AtomicRevocationStepOutcomeV2;
  readonly detail: string;
}

export interface PersonDeletionCommandV2 {
  readonly userId: string;
  readonly actorId: string;
  readonly handlerId: BusinessDeletionHandlerIdV1;
  readonly operationId: string;
}

export interface PersonDeletionReceiptV2 {
  readonly userId: string;
  readonly mode: 'delete';
  readonly transaction: 'committed' | 'rolled_back';
  readonly resultCode: 'identity_deleted' | 'identity_cascade_rolled_back';
  readonly complete: boolean;
  readonly steps: readonly AtomicRevocationStepReceiptV2[];
  readonly business: BusinessDeletionReceiptV1 | null;
  readonly cleanup: Readonly<Record<string, number>>;
  readonly at: string;
}

export interface IdentityDeletionOperationV2 {
  readonly operationId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly handlerId: BusinessDeletionHandlerIdV1;
  readonly requestDigest: string;
  readonly state: 'queued' | 'committed';
  readonly createdAt: string;
  readonly committedAt: string | null;
}

export interface IdentityDeletionAttemptV2 {
  readonly attemptId: string;
  readonly operationId: string;
  readonly at: string;
  readonly receipt: PersonDeletionReceiptV2;
}

export interface AtomicPersonDeletionV2 {
  deletePerson(command: PersonDeletionCommandV2): Promise<PersonDeletionReceiptV2>;
  getOperation(operationId: string): Promise<IdentityDeletionOperationV2 | null>;
  getReceipt(operationId: string): Promise<PersonDeletionReceiptV2 | null>;
}

export interface AtomicPersonDeletionInput<H> {
  readonly unitOfWork: IdentityUnitOfWorkV1<H>;
  readonly business: BusinessDeletionPortV1<H>;
  readonly clock?: import('./types.js').IdentityClock;
  readonly deletionOptions?: IdentityRunOptionsV1;
  readonly diagnosticOptions?: IdentityRunOptionsV1;
  readonly readOptions?: IdentityRunOptionsV1;
}

export interface IdentityExternalRevocationV1 {
  readonly deliveryId: string;
  readonly operationId: string;
  readonly step: string;
  readonly subjectId: string;
  readonly targetKind: string;
  readonly targetRef: string;
  readonly state: 'pending' | 'delivered';
  readonly createdAt: string;
  readonly nextAttemptAt: string;
}

export interface IdentityRevocationClaimV1 {
  readonly deliveryId: string;
  readonly claimOwner: string;
  readonly claimVersion: number;
}

export interface ConnectorRevocationCustodyReferenceV1 {
  readonly custodyRef: string;
  readonly deliveryId: string;
  readonly connectorAccountId: string;
  readonly provider: string;
  readonly createdAt: string;
}

export type ConnectorRevocationCaptureV1 =
  | { readonly kind: 'no_capability' }
  | { readonly kind: 'captured'; readonly reference: ConnectorRevocationCustodyReferenceV1 };

export interface ConnectorRevocationCustodyPortV1<H> {
  capture(input: {
    readonly deliveryId: string;
    readonly connectorAccountId: string;
    readonly subjectId: string;
    readonly workspaceIdsToDelete: readonly string[];
    readonly at: string;
  }, tx: H): Promise<ConnectorRevocationCaptureV1>;
  assertCaptured(record: IdentityExternalRevocationV1, tx: H): Promise<void>;
  eraseAcknowledged(record: IdentityExternalRevocationV1, tx: H): Promise<void>;
}

export interface AcknowledgeRevocationInput<H> {
  readonly tx: H;
  readonly claim: IdentityRevocationClaimV1;
  readonly at: string;
  readonly connectorCustody: ConnectorRevocationCustodyPortV1<H> | null;
}

export interface IdentityLegacyConnectorTombstoneV1 {
  readonly sourceEventId: string;
  readonly connectorAccountId: string;
  readonly provider: string;
  readonly subjectId: string | null;
  readonly disposition: 'queued' | 'unresolved' | 'acknowledged';
  readonly deliveryId: string | null;
  readonly evidenceRef: string | null;
  readonly importedAt: string;
}
