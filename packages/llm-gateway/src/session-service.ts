/**
 * Gateway-owned session service (L1, spec 6.2).
 *
 * Durable caller keys with a 30-day default lifetime: the issuer publishes a
 * new cryptographically random 256-bit key only after durable commit, a
 * crash before commit leaves no issued key, and authenticated idempotent
 * reacquisition returns the same committed key over authenticated control.
 * Only the dedicated authenticated acquisition channel returns keys; every
 * public result carries opaque references, never secrets.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { freezeLaunchRoutingContract, type LaunchRoutingContract } from '@sentropic/llm-mesh';

import {
  GatewayStateError,
  type GatewayStateStore,
  type StoredReceipt,
  type StoredSession,
  type StoredState,
} from './ports/gateway-state.js';
import { isTerminalSettlement } from './request-receipts.js';
import type { StoredRequestAttempt } from './ports/gateway-state.js';
import type { RouteAttemptSettlement } from './route-flow-core.js';

export type { GatewayStateStore, StoredReceipt, StoredSession, StoredState };

export type SessionErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID-KEY'
  | 'REVOKED'
  | 'EXPIRED'
  | 'STORE-FAILED'
  | 'CORRUPT'
  | 'CONFLICT'
  | 'KEY-UNAVAILABLE'
  | 'AMBIGUOUS'
  | 'ALREADY-SETTLED'
  | 'BAD-SETTLEMENT'
  | 'MODEL-NOT-GRANTED'
  | 'NOT-FOUND';

export class GatewaySessionError extends GatewayStateError<SessionErrorCode> {
  constructor(message: string, code: SessionErrorCode) {
    super(message, code);
    this.name = 'GatewaySessionError';
  }
}

export interface AcquireSessionInput {
  readonly routingContract?: LaunchRoutingContract;
  readonly ownerScopeRef: string;
  readonly workspaceRef: string;
  readonly clientSessionRef: string;
  readonly profiles?: readonly string[];
  readonly models?: readonly string[];
  readonly mappingRevision?: string;
  readonly ttlDays?: number;
}

export interface IssuedSession {
  readonly sessionRef: string;
  /** Returned exclusively over authenticated acquisition, including recovery. */
  readonly key?: string;
  readonly reacquired: boolean;
  readonly expiresAt: string;
  readonly policyRevision: string;
}

export interface CallerContext {
  readonly routingContract?: LaunchRoutingContract;
  readonly sessionRef: string;
  readonly ownerScopeRef: string;
  readonly workspaceRef: string;
  readonly clientSessionRef: string;
  readonly profiles: readonly string[];
  readonly models: readonly string[];
  readonly mappingRevision?: string;
  readonly policyRevision: string;
  readonly expiresAt: string;
}

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_DAYS = 30;
const POLICY_REVISION = 'l1-exact-v1';
const trustedContract = (input: Pick<AcquireSessionInput, 'routingContract' | 'ownerScopeRef' | 'models' | 'mappingRevision'>) => {
  if (!input.routingContract) return undefined;
  const contract = freezeLaunchRoutingContract(input.routingContract);
  if (contract.ownerScopeRef !== input.ownerScopeRef
    || (input.models && JSON.stringify([...input.models].sort()) !== JSON.stringify([...contract.exactModels].sort()))
    || (input.mappingRevision && input.mappingRevision !== contract.mapping?.revision)) {
    throw new GatewaySessionError('session routing policy conflicts', 'CONFLICT');
  }
  return contract;
};

const verifierOf = (key: string): Buffer =>
  createHash('sha256').update(key, 'utf8').digest();

const validKey = (candidate: string, verifierHex: string): boolean => {
  const expected = Buffer.from(verifierHex, 'hex');
  if (expected.length !== 32 || !candidate) return false;
  return timingSafeEqual(verifierOf(candidate), expected);
};

const sameTriple = (session: StoredSession, input: AcquireSessionInput): boolean =>
  session.ownerScopeRef === input.ownerScopeRef
  && session.workspaceRef === input.workspaceRef
  && session.clientSessionRef === input.clientSessionRef;

const live = (session: StoredSession, now: number): boolean =>
  session.revokedAt === undefined && Date.parse(session.expiresAt) > now;

const publicSession = (session: StoredSession) => ({
  sessionRef: session.sessionRef,
  workspaceRef: session.workspaceRef,
  clientSessionRef: session.clientSessionRef,
  expiresAt: session.expiresAt,
  revoked: session.revokedAt !== undefined,
  policyRevision: session.policyRevision,
});

export class GatewaySessionService {
  private readonly defaultTtlDays: number;
  private acquisition: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: GatewayStateStore,
    options: { defaultTtlDays?: number } = {},
  ) {
    this.defaultTtlDays = options.defaultTtlDays ?? DEFAULT_TTL_DAYS;
  }

  async acquireSession(input: AcquireSessionInput): Promise<IssuedSession> {
    const result = this.acquisition.then(() => this.acquireCommitted(input));
    this.acquisition = result.catch(() => undefined);
    return result;
  }

  private async acquireCommitted(input: AcquireSessionInput): Promise<IssuedSession> {
    const routingContract = trustedContract(input);
    if (!input.ownerScopeRef || !input.workspaceRef || !input.clientSessionRef) {
      throw new GatewaySessionError('owner identity is required', 'UNAUTHENTICATED');
    }
    const loaded = await this.store.load();
    const now = Date.now();
    const existing = Object.values(loaded.sessions).find(
      (session) => sameTriple(session, input),
    );
    if (existing) {
      if (routingContract && JSON.stringify(existing.routingContract) !== JSON.stringify(routingContract)) throw new GatewaySessionError('session policy requires explicit migration', 'CONFLICT');
      if (existing.revokedAt) throw new GatewaySessionError('session revoked', 'REVOKED');
      if (!live(existing, now)) throw new GatewaySessionError('session expired', 'EXPIRED');
      if (!existing.keyMaterial || !validKey(existing.keyMaterial, existing.keyVerifier)) {
        throw new GatewaySessionError('protected session key unavailable', 'CORRUPT');
      }
      return {
        sessionRef: existing.sessionRef,
        key: existing.keyMaterial,
        reacquired: true,
        expiresAt: existing.expiresAt,
        policyRevision: existing.policyRevision,
      };
    }
    const key = randomBytes(32).toString('base64url');
    const created = new Date(now).toISOString();
    const ttlDays = input.ttlDays ?? this.defaultTtlDays;
    if (!Number.isFinite(ttlDays) || ttlDays <= 0 || ttlDays > 365) {
      throw new GatewaySessionError('invalid session lifetime', 'AMBIGUOUS');
    }
    const session: StoredSession = {
      schemaVersion: SCHEMA_VERSION,
      sessionRef: randomBytes(16).toString('base64url'),
      ownerScopeRef: input.ownerScopeRef,
      workspaceRef: input.workspaceRef,
      clientSessionRef: input.clientSessionRef,
      keyVerifier: verifierOf(key).toString('hex'),
      keyMaterial: key,
      keyId: randomBytes(8).toString('hex'),
      createdAt: created,
      expiresAt: new Date(now + ttlDays * 86_400_000).toISOString(),
      profiles: [...(input.profiles ?? [])],
      models: [...(routingContract?.exactModels ?? input.models ?? [])],
      mappingRevision: routingContract?.mapping?.revision ?? input.mappingRevision,
      policyRevision: routingContract?.revision ?? POLICY_REVISION,
      ...(routingContract ? { routingContract } : {}),
    };
    const next: StoredState = {
      ...loaded,
      revision: loaded.revision + 1,
      sessions: { ...loaded.sessions, [session.sessionRef]: session },
      receipts: loaded.receipts,
    };
    try {
      await this.store.compareAndSet(loaded.revision, next);
    } catch (error) {
      if (error instanceof GatewayStateError && error.code === 'CONFLICT') {
        const reloaded = await this.store.load();
        const winner = Object.values(reloaded.sessions).find(
          (candidate) => sameTriple(candidate, input) && live(candidate, Date.now()),
        );
        if (winner) {
          return {
            sessionRef: winner.sessionRef,
            key: winner.keyMaterial,
            reacquired: true,
            expiresAt: winner.expiresAt,
            policyRevision: winner.policyRevision,
          };
        }
      }
      throw error;
    }
    return {
      sessionRef: session.sessionRef,
      key,
      reacquired: false,
      expiresAt: session.expiresAt,
      policyRevision: session.policyRevision,
    };
  }

  /**
   * Single-writer migration import: preserves existing key bytes instead of
   * issuing new material. Rejects short keys, past expiry, and ambiguous
   * duplicates (including live gateway sessions); the caller quarantines.
   */
  async importSession(input: {
    ownerScopeRef: string;
    workspaceRef: string;
    clientSessionRef: string;
    keyMaterial: string;
    expiresAt: string;
    profiles?: readonly string[];
    models?: readonly string[];
    mappingRevision?: string;
    routingContract?: LaunchRoutingContract;
  }): Promise<{ sessionRef: string; expiresAt: string; receiptId: string }> {
    const routingContract = trustedContract(input);
    if (!input.ownerScopeRef || !input.workspaceRef || !input.clientSessionRef) {
      throw new GatewaySessionError('owner identity is required', 'UNAUTHENTICATED');
    }
    if (typeof input.keyMaterial !== 'string' || input.keyMaterial.length < 43) {
      throw new GatewaySessionError('imported key is too short', 'AMBIGUOUS');
    }
    if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) {
      throw new GatewaySessionError('imported session is expired', 'AMBIGUOUS');
    }
    const loaded = await this.store.load();
    const duplicate = Object.values(loaded.sessions).find(
      (session) =>
        validKey(input.keyMaterial, session.keyVerifier) || (session.ownerScopeRef === input.ownerScopeRef
        && session.workspaceRef === input.workspaceRef
        && session.clientSessionRef === input.clientSessionRef),
    );
    if (duplicate) {
      throw new GatewaySessionError('ambiguous duplicate session', 'AMBIGUOUS');
    }
    const session: StoredSession = {
      schemaVersion: SCHEMA_VERSION,
      sessionRef: randomBytes(16).toString('base64url'),
      ownerScopeRef: input.ownerScopeRef,
      workspaceRef: input.workspaceRef,
      clientSessionRef: input.clientSessionRef,
      keyVerifier: verifierOf(input.keyMaterial).toString('hex'),
      keyMaterial: input.keyMaterial,
      keyId: randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      profiles: [...(input.profiles ?? [])],
      models: [...(routingContract?.exactModels ?? input.models ?? [])],
      mappingRevision: routingContract?.mapping?.revision ?? input.mappingRevision,
      policyRevision: routingContract?.revision ?? POLICY_REVISION,
      ...(routingContract ? { routingContract } : {}),
    };
    const receipt: StoredReceipt = { schemaVersion: SCHEMA_VERSION, receiptId: randomBytes(16).toString('hex'),
      sessionRef: session.sessionRef, ownerScopeRef: session.ownerScopeRef, requestId: 'migration', model: '',
      attempts: 0, physicalAttempts: [], policyRevision: session.policyRevision, settlement: 'migration-ack',
      createdAt: session.createdAt, settledAt: session.createdAt };
    const next: StoredState = {
      ...loaded,
      revision: loaded.revision + 1,
      sessions: { ...loaded.sessions, [session.sessionRef]: session },
      receipts: { ...loaded.receipts, [receipt.receiptId]: receipt },
    };
    await this.store.compareAndSet(loaded.revision, next);
    return { sessionRef: session.sessionRef, expiresAt: session.expiresAt, receiptId: receipt.receiptId };
  }

  async resolveCaller(input: { sessionRef: string; key: string }): Promise<CallerContext> {
    const loaded = await this.store.load();
    const session = loaded.sessions[input.sessionRef];
    if (!session || !validKey(input.key, session.keyVerifier)) {
      throw new GatewaySessionError('unknown session or key', 'INVALID-KEY');
    }
    if (session.revokedAt !== undefined) {
      throw new GatewaySessionError('session revoked', 'REVOKED');
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw new GatewaySessionError('session expired', 'EXPIRED');
    }
    return {
      sessionRef: session.sessionRef,
      ownerScopeRef: session.ownerScopeRef,
      ...(session.routingContract ? { routingContract: freezeLaunchRoutingContract(session.routingContract) } : {}),
      workspaceRef: session.workspaceRef,
      clientSessionRef: session.clientSessionRef,
      profiles: session.profiles,
      models: session.models,
      mappingRevision: session.mappingRevision,
      policyRevision: session.policyRevision,
      expiresAt: session.expiresAt,
    };
  }

  async resolveBearer(key: string): Promise<CallerContext> {
    const loaded = await this.store.load();
    const session = Object.values(loaded.sessions).find((entry) => validKey(key, entry.keyVerifier));
    if (!session) throw new GatewaySessionError('session key refused', 'INVALID-KEY');
    return this.resolveCaller({ sessionRef: session.sessionRef, key });
  }

  async reconcilePending(): Promise<void> {
    const loaded = await this.store.load();
    if (!Object.values(loaded.receipts).some((receipt) => receipt.settlement === 'pending')) return;
    await this.store.compareAndSet(loaded.revision, { ...loaded, revision: loaded.revision + 1,
      receipts: Object.fromEntries(Object.entries(loaded.receipts).map(([id, receipt]) => [id,
        receipt.settlement === 'pending' ? { ...receipt, settlement: 'incomplete', settledAt: new Date().toISOString(),
          physicalAttempts: receipt.physicalAttempts?.map((attempt) => attempt.outcome === 'pending' ? { ...attempt, outcome: 'incomplete' } : attempt) } : receipt])) });
  }

  async revokeSession(input: { ownerScopeRef: string; sessionRef: string }): Promise<{ revoked: boolean }> {
    if (!input.ownerScopeRef) {
      throw new GatewaySessionError('owner identity is required', 'UNAUTHENTICATED');
    }
    const loaded = await this.store.load();
    const session = loaded.sessions[input.sessionRef];
    if (!session || session.ownerScopeRef !== input.ownerScopeRef) {
      throw new GatewaySessionError('unknown session', 'NOT-FOUND');
    }
    if (session.revokedAt !== undefined) return { revoked: true };
    const next: StoredState = {
      ...loaded,
      revision: loaded.revision + 1,
      sessions: {
        ...loaded.sessions,
        [session.sessionRef]: { ...session, revokedAt: new Date(Date.now()).toISOString() },
      },
    };
    await this.store.compareAndSet(loaded.revision, next);
    return { revoked: true };
  }

  async listSessions(input: { ownerScopeRef: string }): Promise<ReturnType<typeof publicSession>[]> {
    if (!input.ownerScopeRef) {
      throw new GatewaySessionError('owner identity is required', 'UNAUTHENTICATED');
    }
    const loaded = await this.store.load();
    return Object.values(loaded.sessions)
      .filter((session) => session.ownerScopeRef === input.ownerScopeRef)
      .map(publicSession);
  }

  async recordAttempt(input: {
    ownerScopeRef: string;
    sessionRef: string;
    requestId: string;
    model: string;
  }): Promise<StoredReceipt> {
    const result = this.acquisition.then(() => this.recordCommitted(input));
    this.acquisition = result.catch(() => undefined);
    return result;
  }

  private async recordCommitted(input: Parameters<GatewaySessionService['recordAttempt']>[0]): Promise<StoredReceipt> {
    const loaded = await this.store.load();
    const session = loaded.sessions[input.sessionRef];
    if (!session || session.ownerScopeRef !== input.ownerScopeRef) {
      throw new GatewaySessionError('unknown session', 'NOT-FOUND');
    }
    if (session.revokedAt) throw new GatewaySessionError('session revoked', 'REVOKED');
    if (!live(session, Date.now())) throw new GatewaySessionError('session expired', 'EXPIRED');
    if (!session.models.includes(input.model)) throw new GatewaySessionError('model is outside the session grant', 'MODEL-NOT-GRANTED');
    const receipt: StoredReceipt = {
      schemaVersion: SCHEMA_VERSION,
      receiptId: randomBytes(16).toString('hex'),
      sessionRef: session.sessionRef,
      ownerScopeRef: session.ownerScopeRef,
      requestId: input.requestId,
      model: input.model,
      attempts: 0,
      physicalAttempts: [],
      policyRevision: session.policyRevision,
      mappingRevision: session.routingContract?.mapping?.revision,
      mappingContentSha256: session.routingContract?.mapping?.contentSha256,
      settlement: 'pending',
      createdAt: new Date(Date.now()).toISOString(),
    };
    const next: StoredState = {
      ...loaded,
      revision: loaded.revision + 1,
      sessions: loaded.sessions,
      receipts: { ...loaded.receipts, [receipt.receiptId]: receipt },
    };
    await this.store.compareAndSet(loaded.revision, next);
    return receipt;
  }

  async settleReceipt(input: {
    ownerScopeRef: string;
    receiptId: string;
    outcome: string;
    attempts?: readonly RouteAttemptSettlement[];
  }): Promise<StoredReceipt> {
    const result = this.acquisition.then(() => this.settleCommitted(input));
    this.acquisition = result.catch(() => undefined);
    return result;
  }

  private async settleCommitted(input: Parameters<GatewaySessionService['settleReceipt']>[0]): Promise<StoredReceipt> {
    const loaded = await this.store.load();
    const receipt = loaded.receipts[input.receiptId];
    if (!receipt || receipt.ownerScopeRef !== input.ownerScopeRef) {
      throw new GatewaySessionError('unknown receipt', 'NOT-FOUND');
    }
    if (receipt.settlement !== 'pending') {
      throw new GatewaySessionError(`receipt already settled as ${receipt.settlement}`, 'ALREADY-SETTLED');
    }
    if (!isTerminalSettlement(input.outcome)) {
      throw new GatewaySessionError(`unknown settlement outcome: ${input.outcome}`, 'BAD-SETTLEMENT');
    }
    const settled: StoredReceipt = {
      ...receipt,
      physicalAttempts: receipt.physicalAttempts?.map((attempt) => {
        const result = input.attempts?.find((row) => row.candidateRef === attempt.candidateRef);
        return result ? { ...attempt, outcome: result.outcome,
          usage: !result.reportedUsage || result.usage.estimated ? null : { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
          observedServedModel: result.observedServedModel ?? null,
          modelEvidence: result.observedServedModel ? 'provider-reported' as const : 'selection-only' as const } : attempt;
      }),
      settlement: input.outcome,
      settledAt: new Date(Date.now()).toISOString(),
    };
    const next: StoredState = {
      ...loaded,
      revision: loaded.revision + 1,
      sessions: loaded.sessions,
      receipts: { ...loaded.receipts, [settled.receiptId]: settled },
    };
    await this.store.compareAndSet(loaded.revision, next);
    return settled;
  }

  async appendAttempt(input: { ownerScopeRef: string; receiptId: string; attempt: StoredRequestAttempt }): Promise<void> {
    const run = this.acquisition.then(async () => {
      const state = await this.store.load(); const receipt = state.receipts[input.receiptId];
      if (!receipt || receipt.ownerScopeRef !== input.ownerScopeRef || receipt.settlement !== 'pending') throw new GatewaySessionError('receipt is unavailable', 'NOT-FOUND');
      if (receipt.physicalAttempts?.some((row) => row.attemptRef === input.attempt.attemptRef)) throw new GatewaySessionError('attempt already recorded', 'CONFLICT');
      const attempts = [...(receipt.physicalAttempts ?? []), input.attempt];
      await this.store.compareAndSet(state.revision, { ...state, revision: state.revision + 1,
        receipts: { ...state.receipts, [receipt.receiptId]: { ...receipt, attempts: attempts.length, physicalAttempts: attempts } } });
    });
    this.acquisition = run.catch(() => undefined); return run;
  }

  async readReceipt(input: { ownerScopeRef: string; receiptId: string }): Promise<StoredReceipt> {
    const loaded = await this.store.load();
    const receipt = loaded.receipts[input.receiptId];
    if (!receipt || receipt.ownerScopeRef !== input.ownerScopeRef) {
      throw new GatewaySessionError('unknown receipt', 'NOT-FOUND');
    }
    return receipt;
  }
}
