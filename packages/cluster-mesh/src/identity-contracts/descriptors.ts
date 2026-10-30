// Identity core contracts: versioned domain descriptors. Each descriptor names
// the records a domain owns and pins the contract version it was frozen at,
// so parallel implementation lots can detect contract drift mechanically.

export const IDENTITY_CONTRACT_VERSION = '1.0.0' as const;

export type IdentityDomainName =
  | 'tenants'
  | 'accounts'
  | 'proofs'
  | 'invitations'
  | 'login_sessions'
  | 'tenant_memberships'
  | 'workspaces'
  | 'resolution'
  | 'tid_oauth'
  | 'revocation'
  | 'decision';

export interface IdentityDomainDescriptor {
  readonly domain: IdentityDomainName;
  readonly version: typeof IDENTITY_CONTRACT_VERSION;
  /** Contract-only: types, ports and doubles; no durable backend yet. */
  readonly status: 'contract-only';
  readonly records: readonly string[];
}

export const IDENTITY_DOMAIN_DESCRIPTORS: readonly IdentityDomainDescriptor[] = [
  { domain: 'tenants', version: IDENTITY_CONTRACT_VERSION, status: 'contract-only', records: ['TenantRecord'] },
  { domain: 'accounts', version: IDENTITY_CONTRACT_VERSION, status: 'contract-only', records: ['UserAccount'] },
  { domain: 'proofs', version: IDENTITY_CONTRACT_VERSION, status: 'contract-only', records: ['IdentityProof'] },
  { domain: 'invitations', version: IDENTITY_CONTRACT_VERSION, status: 'contract-only', records: ['InvitationRecord'] },
  { domain: 'login_sessions', version: IDENTITY_CONTRACT_VERSION, status: 'contract-only', records: ['LoginSession'] },
  {
    domain: 'tenant_memberships',
    version: IDENTITY_CONTRACT_VERSION,
    status: 'contract-only',
    records: ['TenantMembershipRecord'],
  },
  {
    domain: 'workspaces',
    version: IDENTITY_CONTRACT_VERSION,
    status: 'contract-only',
    records: ['WorkspaceRecord', 'WorkspaceMembershipRecord'],
  },
  {
    domain: 'resolution',
    version: IDENTITY_CONTRACT_VERSION,
    status: 'contract-only',
    records: ['AuthoritativeResolution', 'ShadowComparison', 'DivergenceSample'],
  },
  {
    domain: 'tid_oauth',
    version: IDENTITY_CONTRACT_VERSION,
    status: 'contract-only',
    records: ['TidClaim', 'OAuthConsentRecord', 'ServiceClientBinding'],
  },
  {
    domain: 'revocation',
    version: IDENTITY_CONTRACT_VERSION,
    status: 'contract-only',
    records: ['PersonRevocationReceipt', 'RevocationStepReceipt'],
  },
  {
    domain: 'decision',
    version: IDENTITY_CONTRACT_VERSION,
    status: 'contract-only',
    records: ['FreshDecisionInput', 'FreshDecision'],
  },
];

export function identityDomainDescriptor(
  domain: IdentityDomainName,
): IdentityDomainDescriptor | undefined {
  return IDENTITY_DOMAIN_DESCRIPTORS.find((descriptor) => descriptor.domain === domain);
}
