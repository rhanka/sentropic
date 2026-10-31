import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AdmissionError } from '../../src/services/canvas-live/contracts';
import {
  admissionRecord, contextFor, docOf, deltaFrom, framesOf, hostFixture, registryFixture,
} from '../helpers/canvas-live-h3';

/**
 * op2 references op1 without containing it, so applying op2 alone leaves pending
 * structs: exactly the unresolved input §4.11 requires quarantined, not refused.
 */
function pendingOp2(authoritative: Y.Doc): { op1: Uint8Array; op2: Uint8Array } {
  const clientWithDep = new Y.Doc({ gc: false });
  Y.applyUpdate(clientWithDep, Y.encodeStateAsUpdate(authoritative));
  const forkVector = Y.encodeStateVector(clientWithDep);
  clientWithDep.getText('field:notes').insert(0, 'A');
  const op1 = Y.encodeStateAsUpdate(clientWithDep, forkVector);
  const fork = new Y.Doc({ gc: false });
  Y.applyUpdate(fork, Y.encodeStateAsUpdate(authoritative));
  Y.applyUpdate(fork, op1);
  const forkWithDepVector = Y.encodeStateVector(fork);
  fork.getText('field:notes').insert(1, 'B');
  return { op1, op2: Y.encodeStateAsUpdate(fork, forkWithDepVector) };
}

describe('canvas live quarantine wiring', () => {
  it('should quarantine unresolved input with actor and admission instead of refusing it', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied, refusals } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    const { op2 } = pendingOp2(authoritative);
    const result = await host.handleUpdate(contextFor(record), handle.identity, framesOf(op2));
    expect(result).toEqual({ applied: false, closed: false, quarantined: true });
    expect(host.quarantine.size).toBe(1);
    expect(host.quarantine.pendingFor(record.actor.actorId)).toHaveLength(1);
    expect(authoritative.getText('field:notes').toString()).toBe('');
    expect(applied).toHaveLength(0);
    expect(refusals.at(-1)?.refusal).toBe('unresolved-struct');
    await handle.dispose();
  });

  it('should rerun classification, rights and schema checks when dependencies arrive', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    const { op1, op2 } = pendingOp2(authoritative);
    await host.handleUpdate(contextFor(record), handle.identity, framesOf(op2));
    const result = await host.handleUpdate(contextFor(record), handle.identity, framesOf(op1));
    expect(result.applied).toBe(true);
    expect(authoritative.getText('field:notes').toString()).toBe('AB');
    expect(applied).toHaveLength(2);
    expect(host.quarantine.size).toBe(0);
    await handle.dispose();
  });

  it('should not smuggle a quarantined update of a revoked actor through another actor application', async () => {
    const actorA = admissionRecord(['notes']);
    const actorB: typeof actorA = {
      ...actorA,
      actor: { actorId: 'human-b', kind: 'human', displayLabel: 'B', color: '#654321' },
    };
    const { registry } = registryFixture();
    const handleA = registry.open(actorA, 'notes');
    const handleB = registry.open(actorB, 'notes');
    const revoked = { current: false };
    const { host, applied, refusals } = hostFixture({
      record: actorA, registry,
      authorizeUpdate: async (context) => {
        if (context.admission.actor.actorId === actorA.actor.actorId && revoked.current) {
          throw new AdmissionError('revoked');
        }
      },
      resolveAdmission: async (actorId) => {
        if (actorId === actorA.actor.actorId) return revoked.current ? null : contextFor(actorA);
        return contextFor(actorB);
      },
    });
    const authoritative = docOf(registry, actorA, 'notes');
    const { op1, op2 } = pendingOp2(authoritative);
    await host.handleUpdate(contextFor(actorA), handleA.identity, framesOf(op2));
    revoked.current = true;
    const byB = await host.handleUpdate(contextFor(actorB), handleB.identity, framesOf(op1));
    expect(byB.applied).toBe(true);
    expect(authoritative.getText('field:notes').toString()).toBe('A');
    expect(applied).toHaveLength(1);
    expect(host.quarantine.size).toBe(0);
    expect(host.quarantine.refusalsByClass()).toEqual({ 'unresolved-struct': 1 });
    expect(refusals.some((entry) => entry.actorId === actorA.actor.actorId && entry.refusal === 'revoked')).toBe(true);
    await handleA.dispose();
    await handleB.dispose();
  });
});
