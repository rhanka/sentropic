// The root configuration declaration graph must not require an optional provider peer.
// Structural compatibility with the L1 contract is checked at the projection boundary.
type SpeechPlacement = (typeof placements)[number];
type SpeechCapabilityName = (typeof features)[number];
type SpeechStage = 'stt' | 'tts' | 'duplex';
type SpeechPipeline = 'chained' | 'native-duplex';
type SpeechMicMode = 'key' | 'open-mic';
interface SpeechBinding {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly placement: SpeechPlacement;
  readonly language?: string;
  readonly voice?: string;
  readonly region?: string;
  readonly accountRef?: string;
  readonly resourceRef?: string;
}
interface SpeechAudioFormat {
  readonly codec: 'pcm16-le' | 'opus';
  readonly sampleRateHz: 16000 | 24000 | 48000;
  readonly channels: 1;
}

export type SpeechEgress = 'device' | 'cluster' | 'provider';
export interface SpeechProfileSelection {
  readonly profileId: string;
  readonly configRevision: string;
}
export interface SpeechProfileInput extends SpeechProfileSelection {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly pipeline: SpeechPipeline;
  readonly placement: SpeechPlacement;
  readonly bindings: Readonly<Partial<Record<SpeechStage, SpeechBinding>>>;
  readonly micMode: SpeechMicMode;
  readonly policyRef: string;
  readonly egressPolicyRef: string;
  readonly budgetRef: string;
  readonly allowedPlacements: readonly SpeechPlacement[];
  readonly allowedEgress: readonly SpeechEgress[];
  readonly requiredCapabilities: Readonly<Partial<Record<SpeechStage, readonly SpeechCapabilityName[]>>>;
  readonly inputFormats: readonly SpeechAudioFormat[];
  readonly outputFormats: readonly SpeechAudioFormat[];
  readonly maxDurationMs: number;
  readonly maxCostUsd: number;
  readonly fallbacks?: readonly SpeechProfileSelection[];
}
export interface SpeechProfile extends SpeechProfileInput {
  readonly fallbacks: readonly SpeechProfileSelection[];
}
export class SpeechConfigurationError extends Error {
  readonly code = 'invalid_speech_configuration';
  constructor() { super('Invalid speech configuration'); this.name = 'SpeechConfigurationError'; }
}

const placements = [
  'endpoint-native', 'browser-wasm', 'local-companion', 'cluster-hosted', 'cloud-relay',
] as const;
const features = ['streamingStt', 'partialTranscript', 'nativeDuplex', 'tts', 'serverVad', 'clientVad',
  'manualCommit', 'playoutTruncate', 'toolCancellation', 'resume'] as const;
const fail = (): never => { throw new SpeechConfigurationError(); };
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
};
const text = (value: unknown): string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value) ? value : fail();
const choice = <T extends string>(value: unknown, allowed: readonly T[]): T =>
  typeof value === 'string' && allowed.includes(value as T) ? value as T : fail();
const list = <T>(value: unknown, parse: (item: unknown) => T, nonempty = false): T[] => {
  if (!Array.isArray(value) || value.length > 256 || (nonempty && !value.length)) fail();
  return (value as unknown[]).map(parse);
};
const format = (value: unknown): SpeechAudioFormat => {
  const f = object(value); keys(f, ['codec', 'sampleRateHz', 'channels']);
  if (![16000, 24000, 48000].includes(f.sampleRateHz as number) || f.channels !== 1) fail();
  return { codec: choice(f.codec, ['pcm16-le', 'opus']), channels: 1,
    sampleRateHz: f.sampleRateHz as SpeechAudioFormat['sampleRateHz'] };
};
const selection = (value: unknown): SpeechProfileSelection => {
  const s = object(value); keys(s, ['profileId', 'configRevision']);
  return { profileId: text(s.profileId), configRevision: text(s.configRevision) };
};
const binding = (value: unknown): SpeechBinding => {
  const b = object(value);
  keys(b, ['providerId', 'modelId', 'modelRevision', 'adapterId', 'adapterRevision', 'placement',
    'language', 'voice', 'region', 'accountRef', 'resourceRef']);
  const modelRevision = text(b.modelRevision); const adapterRevision = text(b.adapterRevision);
  if ([modelRevision, adapterRevision, b.modelId].some((v) => v === 'latest')) fail();
  const selectors: Record<string, string> = {};
  for (const key of ['language', 'voice', 'region', 'accountRef', 'resourceRef']) {
    if (b[key] !== undefined) selectors[key] = text(b[key]);
  }
  return { providerId: text(b.providerId), modelId: text(b.modelId), modelRevision,
    adapterId: text(b.adapterId), adapterRevision, placement: choice(b.placement, placements), ...selectors };
};
/** Freeze an owned JSON-compatible snapshot, including every nested policy/format/binding. */
export function freezeSpeechSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSpeechSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

function parseProfile(value: unknown): SpeechProfile {
  const p = object(value);
  keys(p, ['schemaVersion', 'profileId', 'configRevision', 'tenantId', 'workspaceId', 'pipeline',
    'placement', 'bindings', 'micMode', 'policyRef', 'egressPolicyRef', 'budgetRef', 'allowedPlacements',
    'allowedEgress', 'requiredCapabilities', 'inputFormats', 'outputFormats', 'maxDurationMs', 'maxCostUsd', 'fallbacks']);
  if (p.schemaVersion !== 1 || !Number.isSafeInteger(p.maxDurationMs) || (p.maxDurationMs as number) <= 0
    || typeof p.maxCostUsd !== 'number' || !Number.isFinite(p.maxCostUsd) || p.maxCostUsd < 0) fail();
  const pipeline = choice(p.pipeline, ['chained', 'native-duplex']);
  const stages: readonly SpeechStage[] = pipeline === 'chained' ? ['stt', 'tts'] : ['duplex'];
  const rawBindings = object(p.bindings); keys(rawBindings, stages);
  const bindings: Partial<Record<SpeechStage, SpeechBinding>> = {};
  for (const stage of stages) bindings[stage] = binding(rawBindings[stage]);
  const rawRequired = object(p.requiredCapabilities); keys(rawRequired, stages);
  const requiredCapabilities: Partial<Record<SpeechStage, SpeechCapabilityName[]>> = {};
  for (const stage of stages) {
    requiredCapabilities[stage] = list(rawRequired[stage] ?? [], (item) => choice(item, features));
  }
  return {
    schemaVersion: 1, profileId: text(p.profileId), configRevision: text(p.configRevision),
    tenantId: text(p.tenantId), workspaceId: text(p.workspaceId), pipeline,
    placement: choice(p.placement, placements), bindings, micMode: choice(p.micMode, ['key', 'open-mic']),
    policyRef: text(p.policyRef), egressPolicyRef: text(p.egressPolicyRef), budgetRef: text(p.budgetRef),
    allowedPlacements: list(p.allowedPlacements, (item) => choice(item, placements), true),
    allowedEgress: list(p.allowedEgress, (item) => choice(item, ['device', 'cluster', 'provider']), true),
    requiredCapabilities, inputFormats: list(p.inputFormats, format, true),
    outputFormats: list(p.outputFormats, format, true), maxDurationMs: p.maxDurationMs as number,
    maxCostUsd: p.maxCostUsd, fallbacks: list(p.fallbacks ?? [], selection),
  };
}

/** Configuration is descriptive. Runtime availability and admission are separately projected. */
export function resolveSpeechProfiles(input: unknown): readonly SpeechProfile[] {
  const profiles = list(input, parseProfile);
  const identity = (p: SpeechProfile) => JSON.stringify([p.tenantId, p.workspaceId, p.profileId, p.configRevision]);
  if (new Set(profiles.map(identity)).size !== profiles.length) fail();
  for (const p of profiles) {
    const seen = new Set<string>();
    for (const fallback of p.fallbacks) {
      const key = JSON.stringify([fallback.profileId, fallback.configRevision]);
      if (seen.has(key) || (fallback.profileId === p.profileId && fallback.configRevision === p.configRevision)
        || !profiles.some((other) => other.tenantId === p.tenantId && other.workspaceId === p.workspaceId
          && other.profileId === fallback.profileId && other.configRevision === fallback.configRevision)) fail();
      seen.add(key);
    }
  }
  return freezeSpeechSnapshot(profiles);
}
