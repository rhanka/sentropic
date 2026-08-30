import type { VerifiedInvocationContext } from '@sentropic/contracts';

export type RegistrationFailureReason =
  | 'missing_registration'
  | 'stale_registration'
  | 'revoked_registration'
  | 'generation_mismatch'
  | 'principal_mismatch'
  | 'workspace_mismatch'
  | 'custody_mismatch'
  | 'actuator_unavailable';

export interface ClusterMeshRegistration {
  readonly registrationId: string;
  readonly generationId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly custodyEpoch: number;
  readonly actuatorRef: string;
  readonly status: 'active' | 'revoked' | 'lost';
  readonly expiresAt: string;
}

export interface RegistrationLookupPort {
  find(registrationId: string): Promise<ClusterMeshRegistration | null>;
}

export interface ActuationRequest {
  readonly registration: ClusterMeshRegistration;
  readonly action: 'drive' | 'wake';
  readonly commandRef: string;
}

export interface ActuationResult {
  readonly effectRef: string;
}

export interface PtyActuatorPort {
  readonly kind: 'pty';
  isAvailable(actuatorRef: string): Promise<boolean>;
  actuate(input: ActuationRequest): Promise<ActuationResult>;
}

export interface SecondaryActuatorPort {
  readonly kind: 'secondary';
  isAvailable(actuatorRef: string): Promise<boolean>;
  actuate(input: ActuationRequest): Promise<ActuationResult>;
}

export type SessionActuatorPort = PtyActuatorPort | SecondaryActuatorPort;

export async function selectPreferredActuator(input: {
  readonly actuatorRef: string;
  readonly pty: PtyActuatorPort;
  readonly secondary?: SecondaryActuatorPort;
}): Promise<SessionActuatorPort | null> {
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
  authorize(context: VerifiedInvocationContext): Promise<RegistrationDecision>;
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
    async authorize(context) {
      const reference = context.registration;
      if (!reference) return { ok: false, reason: 'missing_registration' };
      const registration = await input.registrations.find(reference.registrationId);
      if (!registration) return { ok: false, reason: 'missing_registration' };
      if (registration.status === 'revoked') return { ok: false, reason: 'revoked_registration' };
      const expiry = Date.parse(registration.expiresAt);
      if (registration.status === 'lost' || !Number.isFinite(expiry) || expiry <= now().getTime()) {
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
      if (
        registration.custodyEpoch !== reference.custodyEpoch
        || (context.custody && context.custody.epoch !== registration.custodyEpoch)
        || (context.custody && context.custody.holderPrincipalId !== registration.principalId)
      ) return { ok: false, reason: 'custody_mismatch' };
      if (
        reference.actuatorRef !== registration.actuatorRef
        || reference.expiresAt !== registration.expiresAt
      ) return { ok: false, reason: 'stale_registration' };
      const actuator = await selectPreferredActuator({
        actuatorRef: registration.actuatorRef,
        pty: input.pty,
        secondary: input.secondary,
      });
      if (!actuator) return { ok: false, reason: 'actuator_unavailable' };
      return { ok: true, registration, actuator };
    },
  };
}
