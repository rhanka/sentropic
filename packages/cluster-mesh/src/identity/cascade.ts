// A2.3 identity slice: F14 person revocation composition. The cascade
// itself is frozen in the contracts (`createPersonCascade`); this helper
// binds it over the A2.1/A2.2 store ports plus this lot's durable ledger as
// the audit port, so every revocation is receipted per step and audited into
// the hash-linked ledger. The `agent_plane` step stays queued until M4 binds
// `AgentPlaneRevocationPort`; later planes turn `not_applicable` receipts
// into `applied` without amending the frozen step union.

import { createPersonCascade, type PersonCascade } from '../identity-contracts/enforcement.js';
import type {
  AgentPlaneRevocationPort,
  IdentityAuditPort,
  LoginSessionStore,
  TenantMembershipStore,
  UserAccountStore,
} from '../identity-contracts/ports.js';
import type { IdentityClock } from '../identity-contracts/types.js';

export function createPersonRevocation(input: {
  readonly accounts: UserAccountStore;
  readonly sessions: LoginSessionStore;
  readonly memberships: TenantMembershipStore;
  readonly ledger: IdentityAuditPort;
  readonly agentPlane?: AgentPlaneRevocationPort;
  readonly clock?: IdentityClock;
}): PersonCascade {
  return createPersonCascade({
    accounts: input.accounts,
    sessions: input.sessions,
    memberships: input.memberships,
    agentPlane: input.agentPlane,
    audit: input.ledger,
    clock: input.clock,
  });
}
