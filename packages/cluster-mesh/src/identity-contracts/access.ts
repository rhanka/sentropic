// Identity core contracts: invitations and login sessions (F04, F05).
// Invitation tokens carry the `sit_` prefix; entropy comes from an injected
// port so tests stay deterministic. Login sessions are distinct from agent
// and runtime sessions; revoking one class never touches another directly.

import { IdentityNotFoundError, InvitationError, LoginSessionError } from './errors.js';
import type {
  IdentityAuditPort,
  InvitationStore,
  InvitationTokenPort,
  LoginSessionStore,
} from './ports.js';
import {
  systemIdentityClock,
  type ConsumeInvitationResult,
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
