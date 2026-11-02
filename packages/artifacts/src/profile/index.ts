import { isArtifactId } from '../contracts.js';
import { ARTIFACT_CAPABILITY_NAMES, ArtifactProfileInputError, PROFILE_CONTRACT_VERSION,
  type ArtifactCapabilityName, type ArtifactProviderProfile, type ArtifactSchema,
  type CompiledArtifactsProfile, type EffectiveArtifactProfile } from './contracts.js';
import { copyJson, freezeDeep, isRecord, orderedDigest } from './json.js';
import { assertCompleteOperation, capabilitySchema } from './schemas.js';
import { matchesSchema, normalizeArguments } from './validation.js';
import { RADAR_ARTIFACTS_PROFILE } from './radar.js';
import { compileValidators } from './validators.js';
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
  const snapshot = copyJson(input) as unknown as ArtifactProviderProfile;
  const profile: EffectiveArtifactProfile = { ...snapshot,
    rules: snapshot.rules === undefined ? copyJson(RADAR_ARTIFACTS_PROFILE.rules) as unknown as
      EffectiveArtifactProfile['rules'] : snapshot.rules };
  const allowed = ['version', 'selectedCapabilities', 'operations', 'contractRevisions', 'rules', 'requireExpectedCurrentReleaseId'];
  if (Object.keys(profile).some((key) => !allowed.includes(key)) || profile.version !== PROFILE_CONTRACT_VERSION ||
    !Array.isArray(profile.selectedCapabilities) || !Array.isArray(profile.operations)) throw new Error('invalid artifacts profile');
  const requested = profile.selectedCapabilities;
  if (profile.requireExpectedCurrentReleaseId !== undefined && typeof profile.requireExpectedCurrentReleaseId !== 'boolean') {
    throw new Error('invalid publication precondition policy');
  }
  if (profile.requireExpectedCurrentReleaseId && requested.some(name => [
    'artifacts_promote', 'artifacts_restore', 'artifacts_create_upload', 'artifacts_commit_upload', 'artifacts_fork',
  ].includes(name))) throw new Error('strict profile contains a writer without CAS');
  if (new Set(requested).size !== requested.length ||
    requested.some((name) => !(ARTIFACT_CAPABILITY_NAMES as readonly string[]).includes(name))) {
    throw new Error('unknown or duplicate artifacts capability');
  }
  const selectedCapabilities = ARTIFACT_CAPABILITY_NAMES.filter((name) => requested.includes(name));
  // Canonicalize set-like configuration while retaining command array order.
  (profile as { selectedCapabilities: readonly string[] }).selectedCapabilities = selectedCapabilities;
  const operations = new Set<string>();
  for (const op of profile.operations) {
    if (!op || typeof op.operation !== 'string' || operations.has(op.operation) ||
      !isRecord(op.limits) || !isRecord(op.defaults) ||
      !(ARTIFACT_CAPABILITY_NAMES as readonly string[]).includes(`artifacts_${op.operation}`) ||
      Object.keys(op).some((key) => !['operation', 'limits', 'defaults'].includes(key)) ||
      Object.values(op.limits).some((n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0)) throw new Error('invalid operation profile');
    assertCompleteOperation(op);
    for (const [minimum, maximum] of [['bindingNameMinUnits', 'bindingNameMaxUnits'],
      ['publishFilesMin', 'publishFilesMax'], ['listLimitMin', 'listLimitMax']]) {
      if (op.limits[minimum] > op.limits[maximum]) throw new Error('inconsistent profile bounds');
    }
    operations.add(op.operation);
  }
  const rules = profile.rules;
  const ruleKeys = ['lengthUnit', 'textEncoding', 'callerKeyNormalization', 'rejectLoneSurrogates',
    'provenance', 'keyDerivationAlgorithm', 'pathMaxBytes', 'forbiddenPathPattern', 'reservedFirstSegments', 'mimeTypes'];
  if (!rules || rules.lengthUnit !== 'utf16' || rules.textEncoding !== 'utf8' || rules.callerKeyNormalization !== 'none' ||
    Object.keys(rules).some((key) => !ruleKeys.includes(key)) ||
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
    if (rules.keyDerivationAlgorithm === 'radar-derive-idempotency-v1' && op.limits.idempotencyKeyMaxUnits > 256) {
      throw new Error('profile/derivation key length mismatch');
    }
    const defaults = op.defaults;
    if (profile.requireExpectedCurrentReleaseId && Object.hasOwn(defaults, 'expectedCurrentReleaseId')) {
      throw new Error('publication preconditions cannot be defaulted');
    }
    const schema = schemas[name]!;
    const props = schema.properties as Record<string, ArtifactSchema>;
    for (const [key, value] of Object.entries(defaults)) {
      if (!Object.hasOwn(props, key) || !matchesSchema(value, props[key])) throw new Error('profile/schema default mismatch');
    }
    if (name === 'artifacts_ensure' || name === 'artifacts_publish' || name === 'artifacts_commit_upload'
      || name === 'artifacts_revert') {
      (idempotency as Record<string, unknown>)[name] = { required: true, scope: 'principal' };
    }
  }
  const assertSelected = (name: string): asserts name is ArtifactCapabilityName => {
    if (!(selectedCapabilities as readonly string[]).includes(name)) throw new ArtifactProfileInputError(true);
  };
  const compiled: CompiledArtifactsProfile = {
    ...profile, selectedCapabilities, profile, schemas, idempotency,
    get validators() { return validators; },
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
      if (method === 'POST' && path === '/revert') name = 'artifacts_revert';
      if (method === 'GET' && path.startsWith('/meta/') && isArtifactId(path.slice(6))) name = 'artifacts_get';
      if (method === 'GET' && path.startsWith('/versions/') && isArtifactId(path.slice(10))) name = 'artifacts_list_versions';
      if (method === 'GET' && path.startsWith('/source/') && isArtifactId(path.slice(8))) name = 'artifacts_get_source';
      return name && selectedCapabilities.includes(name) ? name : undefined;
    },
  };
  const validators = compileValidators(compiled);
  compiledProfiles.add(compiled);
  return freezeDeep(compiled);
}
