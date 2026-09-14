import { describe, expect, it } from 'vitest';
import {
  DeliveryActuationHandoffAdapter,
  type ActuationResult,
  type ClusterMeshRegistration,
  type DeliveryActuationHandoffAdapterOptions,
  type DeliveryActuationHandoffRequest,
  type MessageActuationIntent,
  type MessageDelivery,
  type PtyActuatorPort,
  type RegistrationFailureReason,
} from '../src/index.js';
import { messagingFixture, productContext, putRequest } from './messaging-fixture.js';
const intent: MessageActuationIntent = {
  kind: 'session-control', targetRegistrationId: 'registration-1',
  action: 'drive', commandRef: 'command-1',
};
const registration: ClusterMeshRegistration = {
  registrationId: 'registration-1', generationId: 'generation-1',
  principalId: 'workload-1', workspaceId: 'workspace-1',
  custodyHolderPrincipalId: 'workload-1', custodyEpoch: 1,
  actuatorRef: 'pty-1', status: 'active',
  expiresAt: '2031-01-01T00:00:00.000Z', leaseExpiresAt: '2031-01-01T00:00:00.000Z',
};
const invocation = (overrides: Partial<DeliveryActuationHandoffRequest['invocation']> = {}) => ({
  invocationId: intent.commandRef, correlationId: 'correlation-1',
  idempotencyKey: 'invoke-1', custodyToken: 'token-1', ...overrides,
});
const getDelivery = async (
  fixture: ReturnType<typeof messagingFixture>,
): Promise<MessageDelivery> => {
  await fixture.store.put(putRequest('handoff-1', { actuation: intent }));
  const popped = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
  if (!popped.ok || popped.outcome !== 'delivery') throw new Error('Expected delivery');
  return popped.delivery;
};
function handoffFixture(input: {
  readonly result?: ActuationResult;
  readonly actuatorThrows?: boolean;
  readonly registrationFailure?: RegistrationFailureReason;
  readonly instructionFailure?: boolean;
  readonly custodyControlled?: true;
} = {}) {
  const calls = { verified: 0, authorized: 0, resolved: 0, actuated: 0 };
  const seen = new Set<string>();
  const result = input.result ?? { effectRef: 'effect-1', outcome: 'acted' as const };
  const actuator: PtyActuatorPort = {
    kind: 'pty', async isAvailable() { return true; }, async probeState() { return 'alive'; },
    async actuate() {
      calls.actuated += 1;
      if (input.actuatorThrows) throw new Error('transport disconnected');
      return result;
    },
  };
  const options: DeliveryActuationHandoffAdapterOptions = {
    generationId: 'generation-1',
    context: { async verify(request) {
      calls.verified += 1;
      if (request.custodyToken !== 'token-1' || seen.has(request.invocationId)) {
        throw new Error('invalid or replayed custody token');
      }
      seen.add(request.invocationId);
      return {
        invocationId: request.invocationId, correlationId: request.correlationId,
        generationId: 'generation-1',
        principal: { principalId: 'workload-1', kind: 'workload', verifierId: 'verifier-1' },
        workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '1' },
        scopes: ['session:drive'], policyRevision: 'revision-1',
        issuedAt: '2030-01-01T00:00:00.000Z',
        registration: { registrationId: registration.registrationId,
          generationId: registration.generationId, workspaceId: registration.workspaceId,
          actuatorRef: registration.actuatorRef, custodyEpoch: 1, expiresAt: registration.expiresAt },
        custody: { custodyId: 'custody-1', holderPrincipalId: 'workload-1', epoch: 1 },
      };
    } },
    registration: {
      ...(input.custodyControlled ? { custodyControlled: true as const } : {}),
      async authorize() {
        calls.authorized += 1;
        return input.registrationFailure ? { ok: false, reason: input.registrationFailure }
          : { ok: true, registration, actuator };
      },
    },
    instructions: { async resolve() {
      calls.resolved += 1;
      return input.instructionFailure ? null : { kind: 'signed-instruction', signature: 'valid' };
    } },
  };
  return { adapter: new DeliveryActuationHandoffAdapter(options), calls, result };
}
describe('delivery to actuation handoff', () => {
  it('preserves the actuator result and commandRef as the invocationId', async () => {
    const delivery = await getDelivery(messagingFixture());
    const fixture = handoffFixture({ result: {
      effectRef: 'effect-acted', outcome: 'acted', actedTargets: ['target-1'],
    } });
    const output = await fixture.adapter.handoff({ delivery, intent, invocation: invocation() });
    expect(output).toMatchObject({ kind: 'result', commandRef: 'command-1' });
    if (output.kind !== 'result') throw new Error('Expected result');
    expect(output.result).toBe(fixture.result);
    expect(fixture.calls).toEqual({ verified: 1, authorized: 1, resolved: 1, actuated: 1 });
  });
  it('fails closed on deferred actuation under custody without changing the non-custody result', async () => {
    const delivery = await getDelivery(messagingFixture());
    const result = { effectRef: 'effect-deferred', outcome: 'deferred' as const };
    const nonCustody = handoffFixture({ result });
    await expect(nonCustody.adapter.handoff({ delivery, intent, invocation: invocation() }))
      .resolves.toMatchObject({ kind: 'result', result });
    const custody = handoffFixture({ result, custodyControlled: true });
    await expect(custody.adapter.handoff({ delivery, intent, invocation: invocation() }))
      .resolves.toEqual({
        kind: 'uncertain', deliveryId: delivery.deliveryId, commandRef: intent.commandRef,
        actuationAttempted: 'unknown', reason: 'actuation_failed', effectRef: result.effectRef,
      });
    expect(custody.calls.actuated).toBe(1);
  });
  it('rejects substituted intent, invocation mismatch, and garbage custody tokens', async () => {
    const delivery = await getDelivery(messagingFixture());
    const fixture = handoffFixture();
    await expect(fixture.adapter.handoff({
      delivery, intent: { ...intent, action: 'wake' }, invocation: invocation(),
    })).resolves.toMatchObject({ kind: 'refused', reason: 'invalid_handoff' });
    await expect(fixture.adapter.handoff({
      delivery, intent, invocation: invocation({ invocationId: 'command-other' }),
    })).resolves.toMatchObject({ kind: 'refused', reason: 'invalid_handoff' });
    await expect(fixture.adapter.handoff({
      delivery, intent, invocation: invocation({ custodyToken: 'garbage' }),
    })).resolves.toMatchObject({ kind: 'refused', reason: 'unverified_invocation_context' });
    expect(fixture.calls).toEqual({ verified: 1, authorized: 0, resolved: 0, actuated: 0 });
  });
  it('refuses custody/PDP and instruction failures before actuation', async () => {
    const delivery = await getDelivery(messagingFixture());
    const denied = handoffFixture({ registrationFailure: 'custody_mismatch' });
    await expect(denied.adapter.handoff({ delivery, intent, invocation: invocation() }))
      .resolves.toMatchObject({ kind: 'refused', reason: 'custody_mismatch' });
    const unresolved = handoffFixture({ instructionFailure: true });
    await expect(unresolved.adapter.handoff({ delivery, intent, invocation: invocation() }))
      .resolves.toMatchObject({ kind: 'refused', reason: 'command_unresolved' });
    expect([denied.calls.actuated, unresolved.calls.actuated]).toEqual([0, 0]);
  });
  it('replay-fences an uncertain redelivery and terminates it with a quarantined ack', async () => {
    const store = messagingFixture();
    const first = await getDelivery(store);
    const fixture = handoffFixture({ actuatorThrows: true });
    await expect(fixture.adapter.handoff({ delivery: first, intent, invocation: invocation() }))
      .resolves.toMatchObject({ kind: 'uncertain', actuationAttempted: 'unknown' });
    store.advance(101);
    const redelivery = await store.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    if (!redelivery.ok || redelivery.outcome !== 'delivery') throw new Error('Expected redelivery');
    await expect(fixture.adapter.handoff({ delivery: redelivery.delivery, intent, invocation: invocation() }))
      .resolves.toMatchObject({ kind: 'refused', reason: 'unverified_invocation_context' });
    expect(fixture.calls.actuated).toBe(1);
    await expect(store.store.ack({
      context: productContext, deliveryId: redelivery.delivery.deliveryId,
      leaseId: redelivery.delivery.lease.leaseId, ackIdempotencyKey: 'quarantine-1',
      disposition: { kind: 'quarantined', reason: 'uncertain effect reconciled',
        commandRef: intent.commandRef, effectRef: 'reconciliation-1' },
    })).resolves.toEqual({ ok: true, outcome: 'acked' });
    await expect(store.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: true, outcome: 'empty' });
  });
});
