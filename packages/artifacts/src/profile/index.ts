import { isArtifactId } from '../contracts.js';
import { ARTIFACT_CAPABILITY_NAMES, ArtifactProfileInputError, PROFILE_CONTRACT_VERSION,
  type ArtifactCapabilityName, type ArtifactProviderProfile, type ArtifactSchema,
  type CompiledArtifactsProfile } from './contracts.js';
import { copyJson, freezeDeep, orderedDigest } from './json.js';
import { capabilitySchema } from './schemas.js';
import { matchesSchema, normalizeArguments } from './validation.js';
export * from './contracts.js';
export { RADAR_ARTIFACTS_PROFILE } from './radar.js';

const compiledProfiles = new WeakSet<object>();
export function assertCompiledArtifactsProfile(value: unknown): asserts value is CompiledArtifactsProfile {
  if (typeof value !== 'object' || value === null || !compiledProfiles.has(value)) {
    throw new Error('invalid compiled artifacts profile');
  }
}

/** Compile once, before any registry, adapter, schema or integrity evidence. */
export function compileArtifactsProfile(input: ArtifactProviderProfile): CompiledArtifactsProfile {
  const profile = copyJson(input) as unknown as ArtifactProviderProfile;
  const allowed = ['version', 'selection', 'operations', 'contractRevisions', 'rules'];
  if (Object.keys(profile).some((key) => !allowed.includes(key)) || profile.version !== PROFILE_CONTRACT_VERSION ||
    !Array.isArray(profile.selection?.tools) || !Array.isArray(profile.operations)) throw new Error('invalid artifacts profile');
  const requested = profile.selection.tools;
  if (Object.keys(profile.selection).some((key) => key !== 'tools') || new Set(requested).size !== requested.length ||
    requested.some((name) => !(ARTIFACT_CAPABILITY_NAMES as readonly string[]).includes(name))) {
    throw new Error('unknown or duplicate artifacts capability');
  }
  const selectedCapabilities = ARTIFACT_CAPABILITY_NAMES.filter((name) => requested.includes(name));
  // Canonicalize set-like configuration while retaining command array order.
  (profile.selection as { tools: readonly string[] }).tools = selectedCapabilities;
  const operations = new Set<string>();
  for (const op of profile.operations) {
    if (!op || typeof op.operation !== 'string' || operations.has(op.operation) ||
      !op.limits || !op.defaults || Object.keys(op).some((key) => !['operation', 'limits', 'defaults'].includes(key)) ||
      Object.values(op.limits).some((n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0)) throw new Error('invalid operation profile');
    operations.add(op.operation);
  }
  const rules = profile.rules;
  if (!rules || rules.lengthUnit !== 'utf16' || rules.textEncoding !== 'utf8' || rules.callerKeyNormalization !== 'none' ||
    rules.rejectLoneSurrogates !== true || rules.provenance !== 'inline-original' ||
    typeof rules.keyDerivationAlgorithm !== 'string' || !rules.keyDerivationAlgorithm ||
    !Number.isSafeInteger(rules.pathMaxBytes) || rules.pathMaxBytes < 1 || rules.pathMaxBytes > 1024 ||
    !Array.isArray(rules.mimeTypes) || !rules.mimeTypes.length || rules.mimeTypes.some((v) => typeof v !== 'string' || !v) ||
    !Array.isArray(rules.reservedFirstSegments) || rules.reservedFirstSegments.some((v) => typeof v !== 'string' || !v) ||
    rules.forbiddenPathPattern !== '[\\\\%?#:\\u0000-\\u001f\\u007f]') throw new Error('invalid profile semantics');
  if (!profile.contractRevisions || profile.contractRevisions.profile !== PROFILE_CONTRACT_VERSION ||
    profile.contractRevisions.command !== 'artifacts-command/v1' ||
    !profile.contractRevisions.authorization || !profile.contractRevisions.outcome ||
    Object.values(profile.contractRevisions).some((revision) => typeof revision !== 'string' || !revision)) {
    throw new Error('invalid provider contract revisions');
  }
  const schemas: Partial<Record<ArtifactCapabilityName, ArtifactSchema>> = {};
  const idempotency: CompiledArtifactsProfile['idempotency'] = {};
  for (const name of selectedCapabilities) {
    schemas[name] = capabilitySchema(name, profile);
    const op = profile.operations.find((entry) => entry.operation === name.slice(10))!;
    const defaults = op.defaults;
    const schema = schemas[name]!;
    const props = schema.properties as Record<string, ArtifactSchema>;
    for (const [key, value] of Object.entries(defaults)) {
      if (!Object.hasOwn(props, key) || !matchesSchema(value, props[key])) throw new Error('profile/schema default mismatch');
    }
    if (name === 'artifacts_ensure' || name === 'artifacts_publish' || name === 'artifacts_commit_upload') {
      (idempotency as Record<string, unknown>)[name] = { required: true, scope: 'principal' };
    }
  }
  const assertSelected = (name: string): asserts name is ArtifactCapabilityName => {
    if (!(selectedCapabilities as readonly string[]).includes(name)) throw new ArtifactProfileInputError(true);
  };
  const compiled: CompiledArtifactsProfile = {
    selectedCapabilities, profile, schemas, idempotency,
    profileDigest: orderedDigest({ selection: selectedCapabilities, profile, schemas,
      providerContractRevisions: profile.contractRevisions }),
    assertSelected,
    validate(name, args, envelopeKey) {
      if (!(selectedCapabilities as readonly string[]).includes(name)) throw new ArtifactProfileInputError(true);
      return normalizeArguments(profile, name, args, schemas[name as ArtifactCapabilityName]!, envelopeKey);
    },
    capabilityForRoute(method, path) {
      let name: ArtifactCapabilityName | undefined;
      if (method === 'POST' && path === '/ensure') name = 'artifacts_ensure';
      if (method === 'POST' && path === '/publish') name = 'artifacts_publish';
      if (method === 'POST' && path === '/list') name = 'artifacts_list';
      if (method === 'GET' && path.startsWith('/meta/') && isArtifactId(path.slice(6))) name = 'artifacts_get';
      return name && selectedCapabilities.includes(name) ? name : undefined;
    },
  };
  compiledProfiles.add(compiled);
  return freezeDeep(compiled);
}
