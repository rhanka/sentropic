// A2.3 identity slice: the conversation session authority (spec r2 §2.7).
// The verified conversation session is the session authority for
// `conversation_turn` inputs: bound to one (account, workspace), distinct
// from any LoginSession (F05) — login expiry or logout alone never stops a
// running turn, while conversation, account or membership revocation stops
// the next turn. The store lands with this lot (A2.3); the agent-plane and
// runtime stores stay unbound until M4 and keep refusing
// `session_authority_unavailable`.

import type { IdentityAuditPort } from '../identity-contracts/ports.js';
import { systemIdentityClock, type IdentityClock } from '../identity-contracts/types.js';

export type ConversationSessionStatus = 'active' | 'revoked' | 'expired';

export interface ConversationSessionRecord {
  readonly conversationSessionId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly status: ConversationSessionStatus;
  readonly openedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

export interface ConversationSessionInput {
  readonly conversationSessionId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ConversationAuthorityStore {
  saveSession(record: ConversationSessionRecord): Promise<void>;
  findSession(conversationSessionId: string): Promise<ConversationSessionRecord | null>;
  revokeSession(conversationSessionId: string, at: string): Promise<ConversationSessionRecord>;
  listSessionsForUser(userId: string): Promise<readonly ConversationSessionRecord[]>;
}

export class ConversationSessionError extends Error {
  readonly code = 'conversation_session_invalid' as const;

  constructor(readonly reason: 'not_found' | 'expired' | 'revoked') {
    super(`Conversation session is invalid: ${reason}`);
    this.name = 'ConversationSessionError';
  }
}

export interface ConversationAuthorityDomain {
  openSession(
    input: ConversationSessionInput,
    options: { readonly now: string; readonly ttlSeconds: number },
  ): Promise<ConversationSessionRecord>;
  validateSession(conversationSessionId: string, now: string): Promise<ConversationSessionRecord>;
  revokeSession(conversationSessionId: string, actorId: string): Promise<ConversationSessionRecord>;
  listSessionsForUser(userId: string): Promise<readonly ConversationSessionRecord[]>;
}

function addSeconds(now: string, ttlSeconds: number): string {
  return new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
}

export function createConversationAuthority(input: {
  readonly sessions: ConversationAuthorityStore;
  readonly audit: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): ConversationAuthorityDomain {
  const clock = input.clock ?? systemIdentityClock;
  return {
    async openSession(session, options) {
      const record: ConversationSessionRecord = {
        conversationSessionId: session.conversationSessionId,
        userId: session.userId,
        workspaceId: session.workspaceId,
        status: 'active',
        openedAt: options.now,
        expiresAt: addSeconds(options.now, options.ttlSeconds),
      };
      await input.sessions.saveSession(record);
      await input.audit.append({
        at: clock(),
        kind: 'conversation.opened',
        actorId: session.userId,
        subjectId: session.conversationSessionId,
      });
      return record;
    },
    async validateSession(conversationSessionId, now) {
      const session = await input.sessions.findSession(conversationSessionId);
      if (!session) throw new ConversationSessionError('not_found');
      if (session.status === 'revoked') throw new ConversationSessionError('revoked');
      if (session.status === 'expired' || session.expiresAt <= now) {
        throw new ConversationSessionError('expired');
      }
      return session;
    },
    async revokeSession(conversationSessionId, actorId) {
      const session = await input.sessions.findSession(conversationSessionId);
      if (!session) throw new ConversationSessionError('not_found');
      if (session.status === 'revoked') return session;
      const revoked = await input.sessions.revokeSession(conversationSessionId, clock());
      await input.audit.append({
        at: clock(),
        kind: 'conversation.revoked',
        actorId,
        subjectId: conversationSessionId,
      });
      return revoked;
    },
    async listSessionsForUser(userId) {
      return input.sessions.listSessionsForUser(userId);
    },
  };
}

export class InMemoryConversationAuthorityStore implements ConversationAuthorityStore {
  readonly sessions: ConversationSessionRecord[] = [];

  async saveSession(record: ConversationSessionRecord): Promise<void> {
    const existing = this.sessions.findIndex(
      (session) => session.conversationSessionId === record.conversationSessionId,
    );
    if (existing >= 0) this.sessions[existing] = record;
    else this.sessions.push(record);
  }

  async findSession(conversationSessionId: string): Promise<ConversationSessionRecord | null> {
    return (
      this.sessions.find((session) => session.conversationSessionId === conversationSessionId) ?? null
    );
  }

  async revokeSession(conversationSessionId: string, at: string): Promise<ConversationSessionRecord> {
    const existing = this.sessions.find(
      (session) => session.conversationSessionId === conversationSessionId,
    );
    if (!existing) throw new ConversationSessionError('not_found');
    const updated: ConversationSessionRecord = {
      ...existing,
      status: 'revoked',
      revokedAt: at,
    };
    this.sessions[this.sessions.indexOf(existing)] = updated;
    return updated;
  }

  async listSessionsForUser(userId: string): Promise<readonly ConversationSessionRecord[]> {
    return this.sessions.filter((session) => session.userId === userId);
  }
}
