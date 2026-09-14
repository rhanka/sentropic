import type { VerifiedInvocationContext } from '@sentropic/contracts';
import type {
  CustodyTokenVerifierPort,
  SourceVerifiedCustodyRef,
} from './custody-types.js';

export const GATEWAY_RELAUNCH_SCOPE = 'session:relaunch:gateway' as const;

export interface RelaunchLaunchContext {
  readonly gateway: boolean;
}

export type GatewayNamespace = 'gw' | 'no-gw';

type SessionControlAction = 'drive' | 'wake' | 'relaunch';

export interface SessionControlIntent {
  readonly commandRef: string;
  readonly targetRegistrationId: string;
  readonly idempotencyKey: string;
  readonly launchContext?: RelaunchLaunchContext;
}

export interface RelaunchAuthorizationAttributes {
  readonly launchContext: RelaunchLaunchContext;
}

export type RegistrationFailureReason =
  | 'missing_registration'
  | 'stale_registration'
  | 'revoked_registration'
  | 'generation_mismatch'
  | 'principal_mismatch'
  | 'workspace_mismatch'
  | 'custody_required'
  | 'custody_mismatch'
  | 'invalid_launch_context'
  | 'gateway_forbidden'
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
    readonly action: SessionControlAction;
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

interface ActuationRequestBase {
  readonly registration: ClusterMeshRegistration;
  /** Opaque, non-executable identifier. Actuators MUST NOT interpret it as an instruction. */
  readonly commandRef: string;
  readonly resolvedInstruction: SignedInstruction;
}

export type ActuationRequest = ActuationRequestBase & (
  | { readonly action: 'drive'; readonly launchContext?: never }
  | { readonly action: 'wake'; readonly launchContext?: never }
  | { readonly action: 'relaunch'; readonly launchContext: RelaunchLaunchContext }
);

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
  readonly action: SessionControlAction;
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
      readonly action: 'drive';
      readonly registration: ClusterMeshRegistration;
      readonly actuator: SessionActuatorPort;
      readonly launchContext?: never;
    }
  | {
      readonly ok: true;
      readonly action: 'wake';
      readonly registration: ClusterMeshRegistration;
      readonly actuator: SessionActuatorPort;
      readonly launchContext?: never;
    }
  | {
      readonly ok: true;
      readonly action: 'relaunch';
      readonly registration: ClusterMeshRegistration;
      readonly actuator: SessionActuatorPort;
      readonly launchContext: RelaunchLaunchContext;
    }
  | { readonly ok: false; readonly reason: RegistrationFailureReason };

export interface RegistrationGate {
  readonly custodyControlled?: true;
  authorize(
    context: VerifiedInvocationContext,
    action: SessionControlAction,
    attributes?: RelaunchAuthorizationAttributes,
  ): Promise<RegistrationDecision>;
}

const hasExactKeys = (value: object, keys: readonly (string | symbol)[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
};

const resolveLaunchContext = (
  action: SessionControlAction,
  attributes: RelaunchAuthorizationAttributes | undefined,
): { readonly ok: true; readonly launchContext?: RelaunchLaunchContext } | { readonly ok: false } => {
  if (action !== 'relaunch') return attributes === undefined ? { ok: true } : { ok: false };
  if (attributes === undefined) return { ok: true, launchContext: { gateway: false } };
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return { ok: false };
  if (!hasExactKeys(attributes, ['launchContext'])) return { ok: false };
  const launchContext: unknown = attributes.launchContext;
  if (!launchContext || typeof launchContext !== 'object' || Array.isArray(launchContext)) {
    return { ok: false };
  }
  if (!hasExactKeys(launchContext, ['gateway'])) return { ok: false };
  const gateway = (launchContext as { readonly gateway?: unknown }).gateway;
  return typeof gateway === 'boolean'
    ? { ok: true, launchContext: { gateway } }
    : { ok: false };
};

export function createRegistrationGate(input: {
  readonly generationId: string;
  readonly registrations: RegistrationLookupPort;
  readonly pty: PtyActuatorPort;
  readonly secondary?: SecondaryActuatorPort;
  readonly custodyTokens?: CustodyTokenVerifierPort;
  readonly now?: () => Date;
}): RegistrationGate {
  const now = input.now ?? (() => new Date());
  return {
    ...(input.custodyTokens ? { custodyControlled: true as const } : {}),
    async authorize(context, action, attributes) {
      if (
        input.custodyTokens
        && (!context.custody || !('sourceToken' in context.custody))
      ) return { ok: false, reason: 'custody_required' };
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
      const resolved = resolveLaunchContext(action, attributes);
      if (!resolved.ok) return { ok: false, reason: 'invalid_launch_context' };
      if (
        resolved.launchContext?.gateway === true
        && !context.scopes.includes(GATEWAY_RELAUNCH_SCOPE)
      ) return { ok: false, reason: 'gateway_forbidden' };
      if (input.custodyTokens) {
        const custody = context.custody as SourceVerifiedCustodyRef;
        try {
          const decision = await input.custodyTokens.consume(custody.sourceToken, {
            audience: custody.sourceToken.audience,
            registrationId: registration.registrationId,
            action,
            holderPrincipalId: registration.custodyHolderPrincipalId,
            epoch: registration.custodyEpoch,
            custodyId: custody.custodyId,
            invocationId: context.invocationId,
          });
          if (!decision.ok) return { ok: false, reason: 'custody_mismatch' };
        } catch {
          return { ok: false, reason: 'custody_mismatch' };
        }
      }
      const actuator = await selectPreferredActuator({
        actuatorRef: registration.actuatorRef,
        action,
        pty: input.pty,
        secondary: input.secondary,
      });
      if (!actuator) return { ok: false, reason: 'actuator_unavailable' };
      if (action === 'relaunch') {
        return { ok: true, action, registration, actuator, launchContext: resolved.launchContext! };
      }
      if (action === 'drive') return { ok: true, action, registration, actuator };
      return { ok: true, action: 'wake', registration, actuator };
    },
  };
}
