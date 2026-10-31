// The A2.1 slice's store bundle: exactly the ports this lot makes durable.
// Parallel lots (A2.2 tenancy, A2.3 decisions) own disjoint bundles over the
// same frozen port contracts.

import type {
  DeviceCodeStore,
  IdentityAuditPort,
  IdentityProofStore,
  InvitationStore,
  LoginSessionStore,
  UserAccountStore,
} from '../../identity-contracts/index.js';

export interface IdentityAccountStores {
  readonly accounts: UserAccountStore;
  readonly proofs: IdentityProofStore;
  readonly invitations: InvitationStore;
  readonly deviceCodes: DeviceCodeStore;
  readonly sessions: LoginSessionStore;
  readonly audit: IdentityAuditPort;
}
