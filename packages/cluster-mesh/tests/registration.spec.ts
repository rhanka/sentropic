import { describe, expect, it, vi } from 'vitest';
import type { VerifiedInvocationContext } from '../../contracts/src/index.js';
import {
  createRegistrationGate,
  type ClusterMeshRegistration,
  type PtyActuatorPort,
  type SecondaryActuatorPort,
} from '../src/runtime/registration.js';

const registration: ClusterMeshRegistration = {
  registrationId: 'registration-1',
  generationId: 'generation-1',
  principalId: 'workload-1',
  workspaceId: 'workspace-1',
  custodyEpoch: 3,
  actuatorRef: 'actuator-1',
  status: 'active',
  expiresAt: '2026-08-31T12:00:00.000Z',
};

const context: VerifiedInvocationContext = {
  invocationId: 'invocation-1',
  correlationId: 'correlation-1',
  generationId: registration.generationId,
  principal: { principalId: registration.principalId, kind: 'workload', verifierId: 'verifier-1' },
  workspace: { bindingId: 'binding-1', workspaceId: registration.workspaceId, revision: '1' },
  scopes: ['session:drive'],
  policyRevision: 'policy-1',
  registration: {
    registrationId: registration.registrationId,
    generationId: registration.generationId,
    workspaceId: registration.workspaceId,
    actuatorRef: registration.actuatorRef,
    custodyEpoch: registration.custodyEpoch,
    expiresAt: registration.expiresAt,
  },
  custody: { custodyId: 'custody-1', holderPrincipalId: registration.principalId, epoch: 3 },
  issuedAt: '2026-08-30T12:00:00.000Z',
};

function actuatorPorts(ptyAvailable: boolean, secondaryAvailable = true) {
  const pty: PtyActuatorPort = {
    kind: 'pty',
    isAvailable: vi.fn(async () => ptyAvailable),
    actuate: vi.fn(async () => ({ effectRef: 'pty-effect' })),
  };
  const secondary: SecondaryActuatorPort = {
    kind: 'secondary',
    isAvailable: vi.fn(async () => secondaryAvailable),
    actuate: vi.fn(async () => ({ effectRef: 'secondary-effect' })),
  };
  return { pty, secondary };
}

function gate(record: ClusterMeshRegistration | null, ptyAvailable = true) {
  const actuators = actuatorPorts(ptyAvailable);
  return {
    actuators,
    gate: createRegistrationGate({
      generationId: 'generation-1',
      registrations: { async find() { return record; } },
      ...actuators,
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    }),
  };
}

describe('registration gate', () => {
  it('should prefer PTY and consult the secondary actuator only as fallback', async () => {
    const preferred = gate(registration);
    const preferredDecision = await preferred.gate.authorize(context);
    expect(preferredDecision.ok && preferredDecision.actuator.kind).toBe('pty');
    expect(preferred.actuators.secondary.isAvailable).not.toHaveBeenCalled();

    const fallback = gate(registration, false);
    const fallbackDecision = await fallback.gate.authorize(context);
    expect(fallbackDecision.ok && fallbackDecision.actuator.kind).toBe('secondary');
  });

  it('should fail closed with distinct missing, revoked and stale reasons', async () => {
    await expect(gate(null).gate.authorize(context)).resolves.toEqual({
      ok: false,
      reason: 'missing_registration',
    });
    await expect(gate({ ...registration, status: 'revoked' }).gate.authorize(context)).resolves.toEqual({
      ok: false,
      reason: 'revoked_registration',
    });
    await expect(gate({ ...registration, expiresAt: '2026-08-29T12:00:00.000Z' }).gate.authorize(context))
      .resolves.toEqual({ ok: false, reason: 'stale_registration' });
  });

  it('should reject a registration from another generation before actuation', async () => {
    const mismatch = gate({ ...registration, generationId: 'generation-old' });
    await expect(mismatch.gate.authorize(context)).resolves.toEqual({
      ok: false,
      reason: 'generation_mismatch',
    });
    expect(mismatch.actuators.pty.isAvailable).not.toHaveBeenCalled();
  });
});
