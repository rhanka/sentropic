// A4 composition-gaps bundle 1.2.0 descriptors. The frozen 1.0 descriptor
// array and the A2.0b 1.1.0/2.0.0 amendment descriptors are untouched; each
// parallel lot appends its own domain row here (file created by the first
// lot to land, appended by the others on rebase).

export const IDENTITY_COMPOSITION_CONTRACT_VERSION = '1.2.0' as const;

export type IdentityCompositionDomainV1 =
  | 'boundary_resolution'
  | 'oauth_tenant_reads'
  | 'service_principal_tenancy'
  | 'atomic_workspace_deletion'
  | 'identity_replica_sync';

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
    domain: 'atomic_workspace_deletion',
    version: '1.2.0',
    baseContractVersion: '1.0.0',
    amendment: 'A4-composition-gaps',
    status: 'contract-only',
    profiles: ['postgres', 'sqlite'],
    records: ['WorkspaceDeletionCommandV1', 'WorkspaceDeletionReceiptV1', 'WorkspaceBusinessDeletionReceiptV1'],
    ports: ['AtomicWorkspaceDeletionV1', 'WorkspaceDeletionAuthorizationPortV1', 'WorkspaceBusinessDeletionPortV1', 'WorkspaceDeletionPlanePortV1'],
    factories: ['createAtomicWorkspaceDeletionV1'],
    errorType: 'IdentityCustodyErrorV1',
  },
];

export const identityCompositionDescriptorV1 = (
  domain: IdentityCompositionDomainV1,
): IdentityCompositionDescriptorV1 | undefined =>
  IDENTITY_COMPOSITION_DESCRIPTORS.find((entry) => entry.domain === domain);
