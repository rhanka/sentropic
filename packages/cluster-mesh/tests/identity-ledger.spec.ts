// A2.3 spec: the durable audit/escalation ledger (§7.3). Collection regime
// only until an assurance path qualifies (§7.1): approval lands
// `approved_unexecutable` and never executes; the chain is hash-linked and
// append-only, corrections are new records; tampering is detected.

import { describe, expect, it } from 'vitest';
import {
  EscalationCollectionError,
  InMemoryIdentityLedger,
  createEscalationCollection,
  escalationEntryDigest,
  escalationEntryDraftOf,
  type EscalationLedgerEntryDraft,
} from '../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-30T13:00:00.000Z';

type RequestDraft = Parameters<ReturnType<typeof createEscalationCollection>['collectRequest']>[0];

const requestDraft = (overrides: Partial<RequestDraft> = {}): RequestDraft => ({
  escalationId: 'esc-1',
  createdAt: NOW,
  actorAgent: null,
  ownerUserId: 'user-1',
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  scopeKind: 'role',
  storeId: 'store-1',
  tool: 'withdraw',
  targetRef: 'target-1',
  operationDigest: 'op-digest-1',
  idempotencyKey: 'key-1',
  policyRevision: 'policy-1',
  ...overrides,
});

function setup() {
  const ledger = new InMemoryIdentityLedger();
  const collection = createEscalationCollection({ ledger, clock: () => NOW });
  return { ledger, collection };
}

describe('escalation collection regime (§7.2, §7.3)', () => {
  it('should collect a request as the first chain entry and audit it', async () => {
    const { ledger, collection } = setup();
    const entry = await collection.collectRequest(requestDraft(), 'agent-1');
    expect(entry).toMatchObject({
      kind: 'request',
      escalationId: 'esc-1',
      state: 'collected',
      decision: null,
      execution: null,
      cleanup: null,
      reservationRef: null,
    });
    expect(entry.prevEntryHash).toBeNull();
    expect(entry.entryHash).toBe(escalationEntryDigest(escalationEntryDraftOf(entry), null));
    const events = await ledger.listAuditEvents();
    expect(events).toContainEqual({
      at: NOW,
      kind: 'escalation.collected',
      actorId: 'agent-1',
      subjectId: 'esc-1',
      detail: 'withdraw',
    });
  });

  it('should replay idempotently on the same idempotency key', async () => {
    const { collection } = setup();
    const first = await collection.collectRequest(requestDraft(), 'agent-1');
    const replay = await collection.collectRequest(requestDraft(), 'agent-1');
    expect(replay).toEqual(first);
    const chain = await collection.listEscalationChain('esc-1');
    expect(chain).toHaveLength(1);
  });

  it('should link distinct requests of one escalation into a hash chain', async () => {
    const { collection } = setup();
    const first = await collection.collectRequest(requestDraft(), 'agent-1');
    const second = await collection.collectRequest(
      requestDraft({ idempotencyKey: 'key-2', targetRef: 'target-2' }),
      'agent-1',
    );
    expect(second.prevEntryHash).toBe(first.entryHash);
    expect(second.entryHash).toBe(
      escalationEntryDigest(escalationEntryDraftOf(second), first.entryHash),
    );
    const chain = await collection.listEscalationChain('esc-1');
    expect(chain.map((entry) => entry.targetRef)).toEqual(['target-1', 'target-2']);
  });

  it('should land approval as approved_unexecutable, never executed', async () => {
    const { collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    const entry = await collection.decide('esc-1', {
      approve: true,
      byUserId: 'owner-1',
      at: LATER,
      reason: 'evidence-1',
    });
    expect(entry).toMatchObject({
      kind: 'decision',
      state: 'approved_unexecutable',
    });
    expect(entry.decision).toEqual({
      byUserId: 'owner-1',
      at: LATER,
      approve: true,
      assuranceProfile: 'none_qualified',
      evidenceRefs: ['evidence-1'],
    });
    expect(entry.execution).toBeNull();
  });

  it('should land denial as denied', async () => {
    const { collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    const entry = await collection.decide('esc-1', {
      approve: false,
      byUserId: 'owner-1',
      at: LATER,
    });
    expect(entry).toMatchObject({ kind: 'decision', state: 'denied' });
    expect(entry.decision).toMatchObject({ approve: false, assuranceProfile: 'none_qualified' });
  });

  it('should refuse a second decision on the same escalation', async () => {
    const { collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    await collection.decide('esc-1', { approve: true, byUserId: 'owner-1', at: LATER });
    await expect(
      collection.decide('esc-1', { approve: false, byUserId: 'owner-1', at: LATER }),
    ).rejects.toMatchObject({ name: 'EscalationCollectionError', reason: 'already_decided' });
  });

  it('should expire an undecided escalation and refuse deciding after expiry', async () => {
    const { collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    const entry = await collection.expire('esc-1', LATER);
    expect(entry).toMatchObject({ kind: 'decision', state: 'expired' });
    await expect(
      collection.decide('esc-1', { approve: true, byUserId: 'owner-1', at: LATER }),
    ).rejects.toMatchObject({ name: 'EscalationCollectionError', reason: 'already_decided' });
  });

  it('should refuse decisions on unknown escalations', async () => {
    const { collection } = setup();
    await expect(
      collection.decide('esc-ghost', { approve: true, byUserId: 'owner-1', at: LATER }),
    ).rejects.toMatchObject({ name: 'EscalationCollectionError', reason: 'unknown_escalation' });
    await expect(collection.expire('esc-ghost', LATER)).rejects.toMatchObject({
      name: 'EscalationCollectionError',
      reason: 'unknown_escalation',
    });
  });

  it('should expose the typed collection error code', () => {
    const error = new EscalationCollectionError('already_decided');
    expect(error.code).toBe('escalation_collection_invalid');
  });
});

describe('ledger chain integrity (§7.3)', () => {
  it('should verify intact chains', async () => {
    const { ledger, collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    await collection.decide('esc-1', { approve: true, byUserId: 'owner-1', at: LATER });
    const verdicts = await ledger.verifyEscalationChains();
    expect(verdicts).toEqual([{ escalationId: 'esc-1', verified: true }]);
  });

  it('should detect a tampered entry as a hash mismatch', async () => {
    const { ledger, collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    await collection.decide('esc-1', { approve: true, byUserId: 'owner-1', at: LATER });
    // Corrections are new records; a direct edit breaks the sealed digest.
    ledger.escalations[0] = { ...ledger.escalations[0], targetRef: 'target-tampered' };
    const verdicts = await ledger.verifyEscalationChains();
    expect(verdicts).toEqual([{ escalationId: 'esc-1', verified: false, reason: 'hash_mismatch' }]);
  });

  it('should detect a broken predecessor link', async () => {
    const { ledger, collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    await collection.decide('esc-1', { approve: true, byUserId: 'owner-1', at: LATER });
    ledger.escalations[1] = { ...ledger.escalations[1], prevEntryHash: 'deadbeef' };
    const verdicts = await ledger.verifyEscalationChains();
    expect(verdicts).toEqual([{ escalationId: 'esc-1', verified: false, reason: 'unknown_predecessor' }]);
  });

  it('should answer queries by owner, workspace and target', async () => {
    const { ledger, collection } = setup();
    await collection.collectRequest(requestDraft(), 'agent-1');
    await collection.collectRequest(
      requestDraft({
        escalationId: 'esc-2',
        idempotencyKey: 'key-2',
        ownerUserId: 'user-2',
        targetRef: 'target-2',
      }),
      'agent-1',
    );
    const byOwner = await ledger.listEscalations({ ownerUserId: 'user-2' });
    expect(byOwner.map((entry) => entry.escalationId)).toEqual(['esc-2']);
    const byTarget = await ledger.listEscalations({ targetRef: 'target-1' });
    expect(byTarget.map((entry) => entry.escalationId)).toEqual(['esc-1']);
    const byWorkspace = await ledger.listEscalations({ workspaceId: 'ws-1' });
    expect(byWorkspace).toHaveLength(2);
  });

  it('should keep the digest deterministic and independent of key order', () => {
    const base: EscalationLedgerEntryDraft = {
      kind: 'request',
      escalationId: 'esc-1',
      createdAt: NOW,
      actorAgent: null,
      ownerUserId: 'user-1',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      scopeKind: 'role',
      storeId: 'store-1',
      tool: 'withdraw',
      targetRef: 'target-1',
      operationDigest: 'op-digest-1',
      reservationRef: null,
      idempotencyKey: 'key-1',
      policyRevision: 'policy-1',
      decision: null,
      state: 'collected',
      execution: null,
      cleanup: null,
    };
    const reordered = {
      policyRevision: base.policyRevision,
      cleanup: base.cleanup,
      execution: base.execution,
      state: base.state,
      decision: base.decision,
      reservationRef: base.reservationRef,
      idempotencyKey: base.idempotencyKey,
      operationDigest: base.operationDigest,
      targetRef: base.targetRef,
      tool: base.tool,
      storeId: base.storeId,
      scopeKind: base.scopeKind,
      workspaceId: base.workspaceId,
      tenantId: base.tenantId,
      ownerUserId: base.ownerUserId,
      actorAgent: base.actorAgent,
      createdAt: base.createdAt,
      escalationId: base.escalationId,
      kind: base.kind,
    };
    expect(escalationEntryDigest(reordered as EscalationLedgerEntryDraft, null)).toBe(
      escalationEntryDigest(base, null),
    );
  });
});
