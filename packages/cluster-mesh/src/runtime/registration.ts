import type { VerifiedInvocationContext } from '@sentropic/contracts';

export type RegistrationFailureReason =
  | 'missing_registration'
  | 'stale_registration'
  | 'revoked_registration'
  | 'generation_mismatch'
  | 'principal_mismatch'
  | 'workspace_mismatch'
  | 'custody_required'
  | 'custody_mismatch'
  | 'actuator_unavailable'
  | 'command_unresolved';

export type ActuationOutcome = 'acted' | 'deferred' | 'failed';

export type TargetLiveness = 'alive' | 'dead' | 'parked' | 'unknown';

/**
 * Nominal signed-instruction marker. The injected CommandInstructionPort is
 * responsible for cryptographic verification and command/registration binding.
 */
export interface SignedInstruction {
  readonly kind: 'signed-instruction';
  readonly [k: string]: unknown;
}

export interface CommandInstructionPort {
  resolve(input: {
    readonly commandRef: string;
    readonly registrationId: string;
    readonly action: 'drive' | 'wake' | 'relaunch';
  }): Promise<SignedInstruction | null>;
}

export interface ClusterMeshRegistration {
  readonly registrationId: string;
  readonly generationId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly custodyHolderPrincipalId: string;
  readonly custodyEpoch: number;
  readonly actuatorRef: string;
  readonly status: 'active' | 'revoked' | 'lost';
  readonly expiresAt: string;
  readonly leaseExpiresAt: string;
  readonly revokedAt?: string;
  readonly lostAt?: string;
}

export interface RegistrationLookupPort {
  find(registrationId: string): Promise<ClusterMeshRegistration | null>;
}

export interface ActuationRequest {
  readonly registration: ClusterMeshRegistration;
  readonly action: 'drive' | 'wake' | 'relaunch';
  /** Opaque, non-executable identifier. Actuators MUST NOT interpret it as an instruction. */
  readonly commandRef: string;
  readonly resolvedInstruction: SignedInstruction;
}

export interface ActuationResult {
  readonly effectRef: string;
  readonly outcome: ActuationOutcome;
  readonly actedTargets?: readonly string[];
}

export interface PtyActuatorPort {
  readonly kind: 'pty';
  isAvailable(actuatorRef: string): Promise<boolean>;
  probeState(actuatorRef: string): Promise<TargetLiveness>;
  actuate(input: ActuationRequest): Promise<ActuationResult>;
}

export interface SecondaryActuatorPort {
  readonly kind: 'secondary';
  isAvailable(actuatorRef: string): Promise<boolean>;
  probeState(actuatorRef: string): Promise<TargetLiveness>;
  actuate(input: ActuationRequest): Promise<ActuationResult>;
}

export type SessionActuatorPort = PtyActuatorPort | SecondaryActuatorPort;

export async function selectPreferredActuator(input: {
  readonly actuatorRef: string;
  readonly action: 'drive' | 'wake' | 'relaunch';
  readonly pty: PtyActuatorPort;
  readonly secondary?: SecondaryActuatorPort;
}): Promise<SessionActuatorPort | null> {
  if (input.action === 'relaunch') {
    if (await input.pty.probeState(input.actuatorRef) !== 'unknown') return input.pty;
    if (input.secondary && await input.secondary.probeState(input.actuatorRef) !== 'unknown') {
      return input.secondary;
    }
    return null;
  }
  if (await input.pty.isAvailable(input.actuatorRef)) return input.pty;
  if (input.secondary && await input.secondary.isAvailable(input.actuatorRef)) {
    return input.secondary;
  }
  return null;
}

export type RegistrationDecision =
  | {
      readonly ok: true;
      readonly registration: ClusterMeshRegistration;
      readonly actuator: SessionActuatorPort;
    }
  | { readonly ok: false; readonly reason: RegistrationFailureReason };

export interface RegistrationGate {
  authorize(
    context: VerifiedInvocationContext,
    action: 'drive' | 'wake' | 'relaunch',
  ): Promise<RegistrationDecision>;
}

export function createRegistrationGate(input: {
  readonly generationId: string;
  readonly registrations: RegistrationLookupPort;
  readonly pty: PtyActuatorPort;
  readonly secondary?: SecondaryActuatorPort;
  readonly now?: () => Date;
}): RegistrationGate {
  const now = input.now ?? (() => new Date());
  return {
    async authorize(context, action) {
      const reference = context.registration;
      if (!reference) return { ok: false, reason: 'missing_registration' };
      const registration = await input.registrations.find(reference.registrationId);
      if (!registration) return { ok: false, reason: 'missing_registration' };
      if (registration.status === 'revoked') return { ok: false, reason: 'revoked_registration' };
      const expiry = Date.parse(registration.expiresAt);
      const leaseExpiry = Date.parse(registration.leaseExpiresAt);
      if (
        registration.status === 'lost'
        || !Number.isFinite(expiry)
        || !Number.isFinite(leaseExpiry)
        || Math.min(expiry, leaseExpiry) <= now().getTime()
      ) {
        return { ok: false, reason: 'stale_registration' };
      }
      if (
        registration.generationId !== input.generationId
        || reference.generationId !== input.generationId
        || context.generationId !== input.generationId
      ) return { ok: false, reason: 'generation_mismatch' };
      if (registration.principalId !== context.principal.principalId) {
        return { ok: false, reason: 'principal_mismatch' };
      }
      if (
        registration.workspaceId !== context.workspace.workspaceId
        || reference.workspaceId !== context.workspace.workspaceId
      ) return { ok: false, reason: 'workspace_mismatch' };
      if (!context.custody) return { ok: false, reason: 'custody_required' };
      if (
        registration.custodyEpoch !== reference.custodyEpoch
        || context.custody.epoch !== registration.custodyEpoch
        || context.custody.holderPrincipalId !== registration.custodyHolderPrincipalId
      ) return { ok: false, reason: 'custody_mismatch' };
      if (
        reference.actuatorRef !== registration.actuatorRef
        || reference.expiresAt !== registration.expiresAt
      ) return { ok: false, reason: 'stale_registration' };
      const actuator = await selectPreferredActuator({
        actuatorRef: registration.actuatorRef,
        action,
        pty: input.pty,
        secondary: input.secondary,
      });
      if (!actuator) return { ok: false, reason: 'actuator_unavailable' };
      return { ok: true, registration, actuator };
    },
  };
}
