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
  custodyHolderPrincipalId: 'workload-1',
  custodyEpoch: 3,
  actuatorRef: 'actuator-1',
  status: 'active',
  expiresAt: '2026-08-31T12:00:00.000Z',
  leaseExpiresAt: '2026-08-31T11:00:00.000Z',
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
    probeState: vi.fn(async () => ptyAvailable ? 'alive' : 'unknown'),
    actuate: vi.fn(async () => ({ effectRef: 'pty-effect', outcome: 'acted' })),
  };
  const secondary: SecondaryActuatorPort = {
    kind: 'secondary',
    isAvailable: vi.fn(async () => secondaryAvailable),
    probeState: vi.fn(async () => secondaryAvailable ? 'alive' : 'unknown'),
    actuate: vi.fn(async () => ({ effectRef: 'secondary-effect', outcome: 'acted' })),
  };
  return { pty, secondary };
}

function gate(
  record: ClusterMeshRegistration | null,
  ptyAvailable = true,
  secondaryAvailable = true,
) {
  const actuators = actuatorPorts(ptyAvailable, secondaryAvailable);
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
    const preferredDecision = await preferred.gate.authorize(context, 'drive');
    expect(preferredDecision.ok && preferredDecision.actuator.kind).toBe('pty');
    expect(preferred.actuators.secondary.isAvailable).not.toHaveBeenCalled();

    const fallback = gate(registration, false);
    const fallbackDecision = await fallback.gate.authorize(context, 'drive');
    expect(fallbackDecision.ok && fallbackDecision.actuator.kind).toBe('secondary');
  });

  it.each(['dead', 'parked'] as const)(
    'should allow relaunch through PTY when the target is %s',
    async (state) => {
      const relaunch = gate(registration, false, false);
      vi.mocked(relaunch.actuators.pty.probeState).mockResolvedValue(state);

      const decision = await relaunch.gate.authorize(context, 'relaunch');

      expect(decision.ok && decision.actuator.kind).toBe('pty');
      expect(relaunch.actuators.pty.isAvailable).not.toHaveBeenCalled();
      expect(relaunch.actuators.secondary.probeState).not.toHaveBeenCalled();
    },
  );

  it.each(['drive', 'wake'] as const)(
    'should require an alive target for %s',
    async (action) => {
      const unavailable = gate(registration, false, false);
      vi.mocked(unavailable.actuators.pty.probeState).mockResolvedValue('parked');

      await expect(unavailable.gate.authorize(context, action))
        .resolves.toEqual({ ok: false, reason: 'actuator_unavailable' });
      expect(unavailable.actuators.pty.isAvailable).toHaveBeenCalledOnce();
      expect(unavailable.actuators.pty.probeState).not.toHaveBeenCalled();
    },
  );

  it('should reject relaunch when both actuator states are unknown', async () => {
    const unavailable = gate(registration, false, false);

    await expect(unavailable.gate.authorize(context, 'relaunch'))
      .resolves.toEqual({ ok: false, reason: 'actuator_unavailable' });
    expect(unavailable.actuators.pty.probeState).toHaveBeenCalledOnce();
    expect(unavailable.actuators.secondary.probeState).toHaveBeenCalledOnce();
  });

  it('should fail closed with distinct missing, revoked and stale reasons', async () => {
    await expect(gate(null).gate.authorize(context, 'drive')).resolves.toEqual({
      ok: false,
      reason: 'missing_registration',
    });
    await expect(gate({ ...registration, status: 'revoked' }).gate.authorize(context, 'drive')).resolves.toEqual({
      ok: false,
      reason: 'revoked_registration',
    });
    await expect(gate({ ...registration, status: 'lost' }).gate.authorize(context, 'drive')).resolves.toEqual({
      ok: false,
      reason: 'stale_registration',
    });
    await expect(gate({ ...registration, expiresAt: '2026-08-29T12:00:00.000Z' }).gate.authorize(context, 'drive'))
      .resolves.toEqual({ ok: false, reason: 'stale_registration' });
  });

  it('should reject a registration with an invalid expiry as stale', async () => {
    await expect(gate({ ...registration, expiresAt: 'not-a-date' }).gate.authorize({
      ...context,
      registration: { ...context.registration!, expiresAt: 'not-a-date' },
    }, 'drive')).resolves.toEqual({ ok: false, reason: 'stale_registration' });
  });

  it('should reject an expired registration lease as stale', async () => {
    await expect(gate({
      ...registration,
      leaseExpiresAt: '2026-08-29T12:00:00.000Z',
    }).gate.authorize(context, 'drive')).resolves.toEqual({ ok: false, reason: 'stale_registration' });
  });

  it('should reject a registration from another generation before actuation', async () => {
    const mismatch = gate({ ...registration, generationId: 'generation-old' });
    await expect(mismatch.gate.authorize(context, 'drive')).resolves.toEqual({
      ok: false,
      reason: 'generation_mismatch',
    });
    expect(mismatch.actuators.pty.isAvailable).not.toHaveBeenCalled();
  });

  it('should fail closed with custody_required when the context carries no custody', async () => {
    const denied = gate(registration);
    await expect(denied.gate.authorize({ ...context, custody: undefined }, 'drive'))
      .resolves.toEqual({ ok: false, reason: 'custody_required' });
    expect(denied.actuators.pty.isAvailable).not.toHaveBeenCalled();
  });

  it.each([
    ['verified custody', { ...context, custody: { ...context.custody!, epoch: 4 } }],
    ['registration reference', {
      ...context, registration: { ...context.registration!, custodyEpoch: 4 },
    }],
  ] as const)('should reject a mismatched %s epoch before actuator probing', async (_source, requestContext) => {
    const denied = gate(registration);
    await expect(denied.gate.authorize(requestContext, 'drive'))
      .resolves.toEqual({ ok: false, reason: 'custody_mismatch' });
    expect(denied.actuators.pty.isAvailable).not.toHaveBeenCalled();
  });

  it('should reject principal, workspace, custody and actuator mismatches distinctly', async () => {
    await expect(gate({ ...registration, principalId: 'workload-other' }).gate.authorize(context, 'drive'))
      .resolves.toEqual({ ok: false, reason: 'principal_mismatch' });
    await expect(gate({ ...registration, workspaceId: 'workspace-other' }).gate.authorize(context, 'drive'))
      .resolves.toEqual({ ok: false, reason: 'workspace_mismatch' });
    await expect(gate(registration).gate.authorize({
      ...context,
      custody: { ...context.custody!, holderPrincipalId: 'workload-other' },
    }, 'drive')).resolves.toEqual({ ok: false, reason: 'custody_mismatch' });
    await expect(gate(registration, false, false).gate.authorize(context, 'drive'))
      .resolves.toEqual({ ok: false, reason: 'actuator_unavailable' });
  });
});
