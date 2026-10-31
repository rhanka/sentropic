// Identity core contracts: invitations, device enrolment entry and login
// sessions (F04, F05). Invitation tokens carry the `sit_` prefix; entropy comes
// from an injected port so tests stay deterministic. Login sessions are
// distinct from agent and runtime sessions; revoking one class never touches
// another directly.

import { AccountNotActiveError, DeviceCodeError, IdentityNotFoundError, InvitationError, LoginSessionError } from './errors.js';
import type {
  DeviceCodeStore,
  IdentityAuditPort,
  InvitationStore,
  InvitationTokenPort,
  LoginSessionStore,
  UserAccountStore,
} from './ports.js';
import {
  systemIdentityClock,
  type ConsumeInvitationResult,
  type DeviceCodeIssuance,
  type DeviceCodeRecord,
  type DeviceCodePollOutcome,
  type IdentityClock,
  type InvitationInput,
  type InvitationRecord,
  type LoginSession,
  type LoginSessionInput,
} from './types.js';

export interface InvitationDomain {
  issueInvitation(input: InvitationInput, actorId: string): Promise<InvitationRecord>;
  consumeInvitation(token: string, now: string): Promise<ConsumeInvitationResult>;
  revokeInvitation(invitationId: string, actorId: string): Promise<InvitationRecord>;
}

export function createInvitations(input: {
  readonly invitations: InvitationStore;
  readonly tokens: InvitationTokenPort;
  readonly audit: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): InvitationDomain {
  const clock = input.clock ?? systemIdentityClock;
  return {
    async issueInvitation(invitation, actorId) {
      const record: InvitationRecord = {
        ...invitation,
        token: `sit_${input.tokens.issue()}`,
        status: 'pending',
      };
      await input.invitations.saveInvitation(record);
      await input.audit.append({
        at: clock(),
        kind: 'invitation.issued',
        actorId,
        subjectId: invitation.invitationId,
      });
      return record;
    },
    async consumeInvitation(token, now) {
      const invitation = await input.invitations.findInvitationByToken(token);
      if (!invitation) throw new InvitationError('not_found');
      if (invitation.status === 'revoked') throw new InvitationError('revoked');
      if (invitation.status === 'consumed') throw new InvitationError('consumed');
      if (invitation.expiresAt <= now) throw new InvitationError('expired');
      const consumed = await input.invitations.markInvitationConsumed(token, now);
      if (!consumed) throw new InvitationError('consumed');
      return {
        invitation: { ...invitation, status: 'consumed', consumedAt: now },
        emailVerified: true,
      };
    },
    async revokeInvitation(invitationId, actorId) {
      const invitation = await input.invitations.findInvitation(invitationId);
      if (!invitation) throw new IdentityNotFoundError('invitation', invitationId);
      const revoked = await input.invitations.revokeInvitation(invitationId);
      await input.audit.append({
        at: clock(),
        kind: 'invitation.revoked',
        actorId,
        subjectId: invitationId,
      });
      return revoked;
    },
  };
}

/** F04 device-code triplet: the device polls with the device code; the user
    approves with the user code. Approval binds the enrolment to an active
    account; the codes are opaque values from the injected token port. */
export interface DeviceEnrolmentDomain {
  issueDeviceCode(
    device: { readonly deviceName?: string | null },
    options: { readonly now: string; readonly ttlSeconds: number; readonly intervalSec?: number },
  ): Promise<DeviceCodeIssuance>;
  pollDeviceCode(deviceCode: string, now: string): Promise<DeviceCodePollOutcome>;
  approveDeviceCode(
    userCode: string,
    approval: { readonly userId: string },
    now: string,
  ): Promise<DeviceCodeRecord>;
}

export function createDeviceEnrolment(input: {
  readonly deviceCodes: DeviceCodeStore;
  readonly accounts: UserAccountStore;
  readonly tokens: InvitationTokenPort;
  readonly audit: IdentityAuditPort;
}): DeviceEnrolmentDomain {
  return {
    async issueDeviceCode(device, options) {
      const now = options.now;
      const record: DeviceCodeRecord = {
        deviceCode: input.tokens.issue(),
        userCode: input.tokens.issue(),
        deviceName: device.deviceName ?? null,
        status: 'pending',
        issuedAt: now,
        expiresAt: addSeconds(now, options.ttlSeconds),
      };
      await input.deviceCodes.saveDeviceCode(record);
      const issuance: DeviceCodeIssuance = {
        deviceCode: record.deviceCode,
        userCode: record.userCode,
        intervalSec: options.intervalSec ?? 5,
        expiresAt: record.expiresAt,
      };
      await input.audit.append({ at: now, kind: 'device_code.issued', subjectId: record.deviceCode });
      return issuance;
    },
    async pollDeviceCode(deviceCode, now) {
      const record = await input.deviceCodes.findDeviceCode(deviceCode);
      if (!record) throw new DeviceCodeError('not_found');
      if (record.status === 'approved') {
        return { status: 'approved' as const, userId: record.approvedUserId!, deviceName: record.deviceName };
      }
      if (record.expiresAt <= now) return { status: 'expired' as const };
      return { status: 'authorization_pending' as const };
    },
    async approveDeviceCode(userCode, approval, now) {
      const account = await input.accounts.findAccount(approval.userId);
      if (!account || account.accountStatus !== 'active') throw new AccountNotActiveError(approval.userId);
      const record = await input.deviceCodes.findDeviceCodeByUser(userCode);
      if (!record) throw new DeviceCodeError('not_found');
      if (record.expiresAt <= now) throw new DeviceCodeError('expired');
      const approved = await input.deviceCodes.approveDeviceCode(userCode, approval.userId, now);
      if (!approved) throw new DeviceCodeError('already_resolved');
      await input.audit.append({ at: now, kind: 'device_code.approved', actorId: approval.userId, subjectId: userCode });
      return { ...record, status: 'approved', approvedUserId: approval.userId, approvedAt: now };
    },
  };
}

export interface LoginSessionDomain {
  createSession(input: LoginSessionInput, options: { readonly now: string; readonly ttlSeconds: number }): Promise<LoginSession>;
  validateSession(sessionId: string, now: string): Promise<LoginSession>;
  refreshSession(sessionId: string, options: { readonly now: string; readonly ttlSeconds: number }): Promise<LoginSession>;
  revokeSession(sessionId: string, actorId: string): Promise<LoginSession>;
  revokeAllSessionsForUser(userId: string, actorId: string): Promise<number>;
  listSessionsForUser(userId: string): Promise<readonly LoginSession[]>;
}

function addSeconds(now: string, ttlSeconds: number): string {
  return new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
}

export function createLoginSessions(input: {
  readonly sessions: LoginSessionStore;
  readonly clock?: IdentityClock;
}): LoginSessionDomain {
  const clock = input.clock ?? systemIdentityClock;
  async function requireSession(sessionId: string): Promise<LoginSession> {
    const session = await input.sessions.findSession(sessionId);
    if (!session) throw new LoginSessionError('not_found');
    return session;
  }
  return {
    async createSession(session, options) {
      const record: LoginSession = {
        sessionId: session.sessionId,
        userId: session.userId,
        status: 'active',
        mfaState: session.mfaState ?? 'none',
        createdAt: options.now,
        expiresAt: addSeconds(options.now, options.ttlSeconds),
        refreshCount: 0,
      };
      await input.sessions.createSession(record);
      return record;
    },
    async validateSession(sessionId, now) {
      const session = await requireSession(sessionId);
      if (session.status === 'revoked') throw new LoginSessionError('revoked');
      if (session.status === 'expired' || session.expiresAt <= now) {
        throw new LoginSessionError('expired');
      }
      return session;
    },
    async refreshSession(sessionId, options) {
      const session = await requireSession(sessionId);
      if (session.status === 'revoked') throw new LoginSessionError('revoked');
      if (session.expiresAt <= options.now) throw new LoginSessionError('expired');
      return input.sessions.touchSession(sessionId, {
        expiresAt: addSeconds(options.now, options.ttlSeconds),
        refreshCount: session.refreshCount + 1,
      });
    },
    async revokeSession(sessionId, _actorId) {
      const session = await requireSession(sessionId);
      if (session.status === 'revoked') return session;
      return input.sessions.revokeSession(sessionId, clock());
    },
    async revokeAllSessionsForUser(userId, _actorId) {
      return input.sessions.revokeAllSessionsForUser(userId, clock());
    },
    async listSessionsForUser(userId) {
      return input.sessions.listSessionsForUser(userId);
    },
  };
}
