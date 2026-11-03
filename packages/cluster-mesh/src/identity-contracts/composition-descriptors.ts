// A4 composition-gaps bundle (1.2.0) descriptors. The frozen 1.0 descriptor
// array and the A2.0b amendment descriptors are untouched; each parallel lot
// appends its own domain row here (design a4-cm-gaps-r2 §3.1).

export const IDENTITY_COMPOSITION_CONTRACT_VERSION = '1.2.0' as const;

export type IdentityCompositionDomainV1 = 'identity_replica_sync';

export interface IdentityCompositionDescriptorV1 {
  readonly domain: IdentityCompositionDomainV1;
  readonly version: '1.2.0';
  readonly baseContractVersion: '1.0.0';
  readonly amendment: 'A4-composition-gaps';
  readonly status: 'contract-only';
  readonly profiles: readonly ['postgres', 'sqlite'];
  readonly records: readonly string[];
  readonly ports: readonly string[];
  readonly factories: readonly string[];
  readonly errorType: 'IdentityCustodyErrorV1';
}

export const IDENTITY_COMPOSITION_DESCRIPTORS: readonly IdentityCompositionDescriptorV1[] = [
  {
    domain: 'identity_replica_sync',
    version: '1.2.0',
    baseContractVersion: '1.0.0',
    amendment: 'A4-composition-gaps',
    status: 'contract-only',
    profiles: ['postgres', 'sqlite'],
    records: [
      'IdentityReplicaSyncRowV1',
      'IdentityReplicaSyncBatchV1',
      'IdentityReplicaSyncCountsV1',
      'IdentityReplicaSyncReceiptV1',
      'IdentityReplicaSyncIssueReferenceV1',
      'IdentityReplicaSyncValidationV1',
    ],
    ports: ['IdentityReplicaSyncPortV1', 'IdentityReplicaExportPortV1'],
    factories: ['createIdentityReplicaSyncV1', 'createIdentityReplicaExporterV1'],
    errorType: 'IdentityCustodyErrorV1',
  },
];
