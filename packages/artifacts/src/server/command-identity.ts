import { createHash } from 'node:crypto';
import { isArtifactId, type JsonValue } from '../contracts.js';
import { assertCompiledArtifactsProfile, ArtifactProfileInputError,
  type CompiledArtifactsProfile } from '../profile/index.js';
import { assertWellFormed, copyJson, freezeDeep, orderedDigest } from '../profile/json.js';

export const COMMAND_CODEC_VERSION = 'artifacts-command/v1' as const;
export type CallerIdempotencyKey = string & { readonly __brand: 'caller-key' };
export type InternalIdempotencyKey = string & { readonly __brand: 'internal-key' };
export interface CommandIdentity {
  readonly internalKey: InternalIdempotencyKey;
  readonly commandHash: string;
  readonly codecVersion: typeof COMMAND_CODEC_VERSION;
}
export interface EffectiveArtifactCommand {
  readonly operation: 'ensure' | 'publish';
  readonly scopeBinding: string;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly provenance: { readonly kind: 'inline-original' };
  readonly identity: CommandIdentity;
}
export interface ArtifactCommandAuthority { readonly storageScopeId: string; readonly actorId: string }
export interface ArtifactKeyDerivationBinding {
  readonly algorithm: string;
  derive(input: ArtifactCommandAuthority & { readonly operation: 'ensure' | 'publish';
    readonly objectId: string; readonly callerKey: CallerIdempotencyKey }): InternalIdempotencyKey;
}
/** Trusted server input for the compiled command normalizer, never tool arguments. */
export interface ArtifactCommandInput {
  readonly capability: string;
  readonly args: unknown;
  readonly authority: ArtifactCommandAuthority;
  readonly derivation: ArtifactKeyDerivationBinding;
  readonly envelopeKey?: string;
}

/** Preserve Radar's durable bytes only within an explicitly qualified domain. */
export function createRadarKeyDerivation(config: { readonly storageScopeId: string;
  readonly actorIds: readonly string[] }): ArtifactKeyDerivationBinding {
  if (typeof config.storageScopeId !== 'string' || config.storageScopeId.trim() !== config.storageScopeId ||
    !/^[A-Za-z0-9_-]+$/.test(config.storageScopeId) ||
    !Array.isArray(config.actorIds) || !config.actorIds.length) {
    throw new Error('unqualified Radar key domain');
  }
  const scope = config.storageScopeId;
  const actors = new Set(config.actorIds);
  for (const actor of actors) {
    if (typeof actor !== 'string' || !actor.length) throw new Error('invalid Radar actor domain');
    assertWellFormed(actor);
    for (const other of actors) {
      if (other === actor || !other.startsWith(`${actor}|`)) continue;
      const [operation, objectId] = other.slice(actor.length + 1).split('|');
      if ((operation === 'ensure' && objectId === '') || (operation === 'publish' && isArtifactId(objectId))) {
        throw new Error('ambiguous Radar actor domain');
      }
    }
  }
  return Object.freeze({
    algorithm: 'radar-derive-idempotency-v1',
    derive(input) {
      const { storageScopeId, actorId, operation, objectId, callerKey } = input;
      if (storageScopeId !== scope || !actors.has(actorId) ||
        (operation !== 'ensure' && operation !== 'publish') ||
        (operation === 'ensure' ? objectId !== '' : !isArtifactId(objectId))) throw new ArtifactProfileInputError();
      assertWellFormed(callerKey);
      if (!callerKey.trim() || callerKey.length > 256) throw new ArtifactProfileInputError();
      return createHash('sha256').update([scope, actorId, operation, objectId, callerKey].join('|'), 'utf8')
        .digest('hex') as InternalIdempotencyKey;
    },
  } satisfies ArtifactKeyDerivationBinding);
}

export const commandDigest = orderedDigest;

/** No caller hash, actor, scope, transport or audit identifier enters this API through arguments. */
export function createArtifactCommand(profile: CompiledArtifactsProfile, name: string, args: unknown,
  authority: ArtifactCommandAuthority, derivation: ArtifactKeyDerivationBinding,
  envelopeKey?: string): EffectiveArtifactCommand {
  assertCompiledArtifactsProfile(profile);
  if (derivation.algorithm !== profile.profile.rules.keyDerivationAlgorithm) throw new Error('profile/derivation mismatch');
  const normalized = profile.validate(name, args, envelopeKey);
  if (name !== 'artifacts_ensure' && name !== 'artifacts_publish') throw new ArtifactProfileInputError(true);
  const operation = name === 'artifacts_ensure' ? 'ensure' : 'publish';
  const { idempotencyKey, ...payload } = normalized;
  const scopeBinding = authority.storageScopeId;
  if (typeof scopeBinding !== 'string' || typeof authority.actorId !== 'string') throw new ArtifactProfileInputError();
  assertWellFormed(scopeBinding);
  assertWellFormed(authority.actorId);
  if (!scopeBinding || !authority.actorId) throw new ArtifactProfileInputError();
  const provenance = { kind: 'inline-original' } as const;
  const effective = copyJson({ operation, scopeBinding, payload: { ...payload, provenance } }) as unknown as
    Omit<EffectiveArtifactCommand, 'identity' | 'provenance'>;
  const internalKey = derivation.derive({ storageScopeId: scopeBinding, actorId: authority.actorId, operation,
    objectId: operation === 'publish' ? normalized.artifactId as string : '',
    callerKey: idempotencyKey as CallerIdempotencyKey });
  if (!/^[0-9a-f]{64}$/.test(internalKey) || !derivation.algorithm) throw new Error('invalid key derivation binding');
  return freezeDeep({ ...effective, provenance, identity: { internalKey,
    commandHash: commandDigest(effective), codecVersion: COMMAND_CODEC_VERSION } });
}
