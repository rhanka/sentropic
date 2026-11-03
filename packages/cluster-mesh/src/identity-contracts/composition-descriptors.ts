// A4-composition-gaps bundle 1.2.0: additive composition descriptors. The
// frozen 1.0 descriptor array and the A2.0b 1.1.0/2.0.0 amendment descriptors
// stay untouched; each parallel lot appends its own domain row here (the file
// is created by whichever lot lands first).

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
    domain: 'service_principal_tenancy',
    version: '1.2.0',
    baseContractVersion: '1.0.0',
    amendment: 'A4-composition-gaps',
    status: 'contract-only',
    profiles: ['postgres', 'sqlite'],
    records: ['ServiceTidClaimV1'],
    ports: ['ServiceTenantEnrollmentSourceV1', 'ServicePrincipalTidIssuerV1'],
    factories: ['createServicePrincipalTidIssuerV1'],
    errorType: 'IdentityCustodyErrorV1',
  },
];
