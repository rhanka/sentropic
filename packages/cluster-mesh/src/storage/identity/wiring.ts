// Composition seam for the A2.1 slice: binds the frozen domain factories to
// a durable store bundle. Hosts call this with either profile's stores; the
// domains themselves never learn which dialect is underneath.

import { randomBytes } from 'node:crypto';
import {
  createDeviceEnrolment,
  createIdentityProofs,
  createInvitations,
  createLoginSessions,
  createUserAccounts,
  type DeviceEnrolmentDomain,
  type IdentityClock,
  type IdentityProofDomain,
  type InvitationDomain,
  type InvitationTokenPort,
  type LoginSessionDomain,
  type UserAccountDomain,
} from '../../identity-contracts/index.js';
import type { IdentityAccountStores } from './stores.js';

export interface IdentityDomainSlice {
  readonly accounts: UserAccountDomain;
  readonly proofs: IdentityProofDomain;
  readonly invitations: InvitationDomain;
  readonly deviceEnrolment: DeviceEnrolmentDomain;
  readonly loginSessions: LoginSessionDomain;
}

export interface WireIdentityDomainsInput {
  readonly stores: IdentityAccountStores;
  /** Opaque invitation/device token source; defaults to cryptographic bytes. */
  readonly tokens?: InvitationTokenPort;
  readonly clock?: IdentityClock;
}

/** Wires the five A2.1 domains onto a durable store bundle. */
export const wireIdentityDomains = (input: WireIdentityDomainsInput): IdentityDomainSlice => {
  const { stores, tokens = createCryptoTokenPort(), clock } = input;
  return {
    accounts: createUserAccounts({ accounts: stores.accounts, audit: stores.audit, clock }),
    proofs: createIdentityProofs({ proofs: stores.proofs, clock }),
    invitations: createInvitations({ invitations: stores.invitations, tokens, audit: stores.audit, clock }),
    deviceEnrolment: createDeviceEnrolment({
      deviceCodes: stores.deviceCodes,
      accounts: stores.accounts,
      tokens,
      audit: stores.audit,
    }),
    loginSessions: createLoginSessions({ sessions: stores.sessions, clock }),
  };
};

/** Cryptographic invitation/device token source (`node:crypto`, base64url). */
export const createCryptoTokenPort = (): InvitationTokenPort => ({
  issue: (): string => randomBytes(24).toString('base64url'),
});
