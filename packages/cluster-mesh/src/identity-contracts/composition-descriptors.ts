// A4 composition gaps, bundle 1.2.0: versioned descriptors for the additive
// composition pieces (P2–P6 of a4-cm-gaps-r2). The frozen 1.0 descriptor array
// and the A2.0b amendment descriptors are untouched; each parallel lot appends
// its own domain row here, so the domain union below already names all five.

export const IDENTITY_COMPOSITION_CONTRACT_VERSION = '1.2.0' as const;

export type IdentityCompositionDomainV1 =
  | 'boundary_resolution'
  | 'oauth_tenant_reads'
  | 'service_principal_tenancy'
  | 'atomic_workspace_deletion'
  | 'identity_replica_sync';

export interface IdentityCompositionDescriptorV1 {
  readonly domain: IdentityCompositionDomainV1;
  readonly version: typeof IDENTITY_COMPOSITION_CONTRACT_VERSION;
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
    domain: 'boundary_resolution',
    version: IDENTITY_COMPOSITION_CONTRACT_VERSION,
    baseContractVersion: '1.0.0',
    amendment: 'A4-composition-gaps',
    status: 'contract-only',
    profiles: ['postgres', 'sqlite'],
    records: ['TenantBoundaryResolutionV1'],
    ports: ['TenantBoundaryPortV1'],
    factories: ['createTenantBoundaryPortV1', 'createIdentityBoundaryDomainV1'],
    errorType: 'IdentityCustodyErrorV1',
  },
];

export const identityCompositionDescriptorV1 = (
  domain: IdentityCompositionDomainV1,
): IdentityCompositionDescriptorV1 | undefined =>
  IDENTITY_COMPOSITION_DESCRIPTORS.find((entry) => entry.domain === domain);
