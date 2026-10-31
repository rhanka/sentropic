// A2.3 identity slice: the durable audit/escalation ledger (spec r2 §2.9,
// §7.3). Append-only and hash-linked per escalation; corrections are new
// records, never edits. The entry-kind union is frozen complete against r2 —
// L3 turns `reservation`, `presentation`, `attachment`, `execution` and
// `cleanup` from never-minted kinds into live ones without amending the
// schema. Until an assurance path qualifies (§7.1), the regime is collection
// only: a request is collected, may be approved (landing
// `approved_unexecutable`, never executed), denied, or expired — every
// transition traced, nothing silently dropped. Audit events share the ledger
// as the durable home of the frozen `IdentityAuditPort`.

import { createHash } from 'node:crypto';
import type { IdentityAuditPort } from '../identity-contracts/ports.js';
import { systemIdentityClock, type IdentityAuditEvent, type IdentityClock } from '../identity-contracts/types.js';

/** §7.3 chain record kinds; frozen complete, L3 fills the execution regime. */
export type EscalationEntryKind =
  | 'request'
  | 'reservation'
  | 'presentation'
  | 'decision'
  | 'attachment'
  | 'execution'
  | 'cleanup';

export interface EscalationActorAgent {
  /** Level-1 memorial agent id; correlation ids never substitute for it. */
  readonly memorialAgentId: string;
  /** Level-2 agent session id (§2.4), distinct from the level-1 id. */
  readonly agentSessionId: string;
  readonly cliKind: string;
  readonly model?: string;
}

export type EscalationScopeKind = 'role' | 'repo';
export type EscalationTool = 'withdraw' | 'forget';
export type EscalationState = 'collected' | 'approved_unexecutable' | 'denied' | 'expired';

export interface EscalationDecision {
  readonly byUserId: string;
  readonly at: string;
  readonly approve: boolean;
  /** Collection regime: no assurance path is qualified (§7.1), so approval
      lands `approved_unexecutable` and never executes by workaround. */
  readonly assuranceProfile: 'none_qualified';
  readonly evidenceRefs: readonly string[];
}

export interface EscalationExecution {
  readonly attemptedAt: string;
  readonly resultEnvelopeAuditId: string;
  readonly outcomeClass: string;
}

export interface EscalationCleanup {
  readonly surfaces: readonly string[];
  readonly statusBySurface: Readonly<Record<string, string>>;
}

export interface EscalationLedgerEntry {
  readonly kind: EscalationEntryKind;
  readonly escalationId: string;
  readonly createdAt: string;
  /** Actor agent chain (L1 + L2 + CLI kind); the agent plane lands M4, so a
      collection entry filed by the owner may carry null until then. */
  readonly actorAgent: EscalationActorAgent | null;
  readonly ownerUserId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly scopeKind: EscalationScopeKind;
  readonly storeId: string;
  readonly tool: EscalationTool;
  readonly targetRef: string;
  readonly operationDigest: string;
  readonly reservationRef: string | null;
  readonly idempotencyKey: string;
  readonly policyRevision: string;
  readonly decision: EscalationDecision | null;
  readonly state: EscalationState;
  readonly execution: EscalationExecution | null;
  readonly cleanup: EscalationCleanup | null;
  readonly prevEntryHash: string | null;
  readonly entryHash: string;
}

/** Entry as authored before the ledger seals it into the hash-linked chain. */
export type EscalationLedgerEntryDraft = Omit<EscalationLedgerEntry, 'prevEntryHash' | 'entryHash'>;

export interface EscalationChainVerification {
  readonly escalationId: string;
  readonly verified: boolean;
  readonly reason?: 'hash_mismatch' | 'unknown_predecessor';
}

export interface EscalationLedgerQuery {
  readonly ownerUserId?: string;
  readonly workspaceId?: string;
  readonly targetRef?: string;
}

/** Durable ledger store: the frozen audit append plus the §7.3 read side. */
export interface IdentityLedgerStore extends IdentityAuditPort {
  listAuditEvents(): Promise<readonly IdentityAuditEvent[]>;
  /** Appends one chain entry; the ledger seals `prevEntryHash`/`entryHash`
      from the current tail inside the same transaction. */
  appendEscalationEntry(draft: EscalationLedgerEntryDraft): Promise<EscalationLedgerEntry>;
  listEscalationChain(escalationId: string): Promise<readonly EscalationLedgerEntry[]>;
  listEscalations(query: EscalationLedgerQuery): Promise<readonly EscalationLedgerEntry[]>;
  verifyEscalationChains(): Promise<readonly EscalationChainVerification[]>;
}

export class EscalationCollectionError extends Error {
  readonly code = 'escalation_collection_invalid' as const;

  constructor(readonly reason: 'unknown_escalation' | 'already_decided' | 'invalid_entry') {
    super(`Escalation collection is invalid: ${reason}`);
    this.name = 'EscalationCollectionError';
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

export const escalationEntryDigest = (
  draft: EscalationLedgerEntryDraft,
  prevEntryHash: string | null,
): string =>
  createHash('sha256')
    .update(JSON.stringify([prevEntryHash, canonicalize(draft)]))
    .digest('hex');

/** Strips the sealed hash fields so a stored entry re-hashes to its digest. */
export const escalationEntryDraftOf = (
  entry: EscalationLedgerEntry,
): EscalationLedgerEntryDraft => {
  const { prevEntryHash: _prev, entryHash: _hash, ...draft } = entry;
  return draft;
};

/** §7.2 collection regime: collect, decide, expire — execution refuses until
    an assurance path qualifies (L3); approval stays `approved_unexecutable`. */
export interface EscalationCollectionDomain {
  collectRequest(
    draft: Omit<EscalationLedgerEntryDraft, 'kind' | 'state' | 'decision' | 'execution' | 'cleanup' | 'reservationRef'>,
    actorId: string,
  ): Promise<EscalationLedgerEntry>;
  decide(
    escalationId: string,
    decision: { readonly approve: boolean; readonly byUserId: string; readonly at: string; readonly reason?: string },
  ): Promise<EscalationLedgerEntry>;
  expire(escalationId: string, at: string): Promise<EscalationLedgerEntry>;
  listEscalationChain(escalationId: string): Promise<readonly EscalationLedgerEntry[]>;
}

export function createEscalationCollection(input: {
  readonly ledger: IdentityLedgerStore;
  readonly audit?: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): EscalationCollectionDomain {
  const clock = input.clock ?? systemIdentityClock;
  const audit = input.audit ?? input.ledger;
  const collectRequest = async (
    escalationId: string,
    idempotencyKey: string,
  ): Promise<EscalationLedgerEntry | null> => {
    const existing = await input.ledger.listEscalationChain(escalationId);
    return existing.find((entry) => entry.idempotencyKey === idempotencyKey) ?? null;
  };
  return {
    async collectRequest(draft, actorId) {
      const replay = await collectRequest(draft.escalationId, draft.idempotencyKey);
      if (replay) return replay;
      const entry = await input.ledger.appendEscalationEntry({
        ...draft,
        kind: 'request',
        state: 'collected',
        reservationRef: null,
        decision: null,
        execution: null,
        cleanup: null,
      });
      await audit.append({
        at: clock(),
        kind: 'escalation.collected',
        actorId,
        subjectId: entry.escalationId,
        detail: entry.tool,
      });
      return entry;
    },
    async decide(escalationId, decision) {
      const chain = await input.ledger.listEscalationChain(escalationId);
      if (chain.length === 0) throw new EscalationCollectionError('unknown_escalation');
      const request = chain.find((entry) => entry.kind === 'request');
      if (!request) throw new EscalationCollectionError('unknown_escalation');
      if (chain.some((entry) => entry.kind === 'decision')) {
        throw new EscalationCollectionError('already_decided');
      }
      const entry = await input.ledger.appendEscalationEntry({
        kind: 'decision',
        escalationId,
        createdAt: decision.at,
        actorAgent: request.actorAgent,
        ownerUserId: request.ownerUserId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        scopeKind: request.scopeKind,
        storeId: request.storeId,
        tool: request.tool,
        targetRef: request.targetRef,
        operationDigest: request.operationDigest,
        reservationRef: null,
        idempotencyKey: `${request.idempotencyKey}:decision:${decision.approve ? 'approve' : 'deny'}`,
        policyRevision: request.policyRevision,
        decision: {
          byUserId: decision.byUserId,
          at: decision.at,
          approve: decision.approve,
          assuranceProfile: 'none_qualified',
          evidenceRefs: decision.reason ? [decision.reason] : [],
        },
        state: decision.approve ? 'approved_unexecutable' : 'denied',
        execution: null,
        cleanup: null,
      });
      await audit.append({
        at: clock(),
        kind: 'escalation.decided',
        actorId: decision.byUserId,
        subjectId: escalationId,
        detail: decision.approve ? 'approve' : 'deny',
      });
      return entry;
    },
    async expire(escalationId, at) {
      const chain = await input.ledger.listEscalationChain(escalationId);
      if (chain.length === 0) throw new EscalationCollectionError('unknown_escalation');
      const request = chain.find((entry) => entry.kind === 'request');
      if (!request) throw new EscalationCollectionError('unknown_escalation');
      if (chain.some((entry) => entry.kind === 'decision')) {
        throw new EscalationCollectionError('already_decided');
      }
      const entry = await input.ledger.appendEscalationEntry({
        kind: 'decision',
        escalationId,
        createdAt: at,
        actorAgent: request.actorAgent,
        ownerUserId: request.ownerUserId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        scopeKind: request.scopeKind,
        storeId: request.storeId,
        tool: request.tool,
        targetRef: request.targetRef,
        operationDigest: request.operationDigest,
        reservationRef: null,
        idempotencyKey: `${request.idempotencyKey}:expired`,
        policyRevision: request.policyRevision,
        decision: null,
        state: 'expired',
        execution: null,
        cleanup: null,
      });
      await audit.append({
        at: clock(),
        kind: 'escalation.expired',
        subjectId: escalationId,
      });
      return entry;
    },
    async listEscalationChain(escalationId) {
      return input.ledger.listEscalationChain(escalationId);
    },
  };
}

export class InMemoryIdentityLedger implements IdentityLedgerStore {
  readonly events: IdentityAuditEvent[] = [];
  readonly escalations: EscalationLedgerEntry[] = [];

  async append(event: IdentityAuditEvent): Promise<void> {
    this.events.push(event);
  }

  async listAuditEvents(): Promise<readonly IdentityAuditEvent[]> {
    return [...this.events];
  }

  async appendEscalationEntry(draft: EscalationLedgerEntryDraft): Promise<EscalationLedgerEntry> {
    const tail = this.escalations
      .filter((entry) => entry.escalationId === draft.escalationId)
      .at(-1);
    const prevEntryHash = tail ? tail.entryHash : null;
    const entry: EscalationLedgerEntry = {
      ...draft,
      prevEntryHash,
      entryHash: escalationEntryDigest(draft, prevEntryHash),
    };
    this.escalations.push(entry);
    return entry;
  }

  async listEscalationChain(escalationId: string): Promise<readonly EscalationLedgerEntry[]> {
    return this.escalations.filter((entry) => entry.escalationId === escalationId);
  }

  async listEscalations(query: EscalationLedgerQuery): Promise<readonly EscalationLedgerEntry[]> {
    return this.escalations.filter(
      (entry) =>
        (query.ownerUserId === undefined || entry.ownerUserId === query.ownerUserId) &&
        (query.workspaceId === undefined || entry.workspaceId === query.workspaceId) &&
        (query.targetRef === undefined || entry.targetRef === query.targetRef),
    );
  }

  async verifyEscalationChains(): Promise<readonly EscalationChainVerification[]> {
    const byId = new Map<string, EscalationLedgerEntry[]>();
    for (const entry of this.escalations) {
      const chain = byId.get(entry.escalationId) ?? [];
      chain.push(entry);
      byId.set(entry.escalationId, chain);
    }
    const results: EscalationChainVerification[] = [];
    for (const [escalationId, chain] of byId) {
      let verified = true;
      let reason: EscalationChainVerification['reason'];
      let prev: string | null = null;
      for (const entry of chain) {
        if (entry.prevEntryHash !== prev) {
          verified = false;
          reason = 'unknown_predecessor';
          break;
        }
        if (entry.entryHash !== escalationEntryDigest(escalationEntryDraftOf(entry), entry.prevEntryHash)) {
          verified = false;
          reason = 'hash_mismatch';
          break;
        }
        prev = entry.entryHash;
      }
      results.push(
        verified
          ? { escalationId, verified: true }
          : { escalationId, verified: false, reason: reason ?? 'hash_mismatch' },
      );
    }
    return results;
  }
}
