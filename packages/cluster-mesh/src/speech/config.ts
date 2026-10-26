import type {
  SpeechAudioFormat, SpeechBinding, SpeechCapabilityName, SpeechMicMode, SpeechPipeline,
  SpeechPlacement, SpeechStage,
} from '@sentropic/llm-mesh/speech';

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

const placements = ['endpoint-native', 'browser-wasm', 'local-companion', 'cluster-hosted', 'cloud-relay']
  as const satisfies readonly SpeechPlacement[];
const features = ['streamingStt', 'partialTranscript', 'nativeDuplex', 'tts', 'serverVad', 'clientVad',
  'manualCommit', 'playoutTruncate', 'toolCancellation', 'resume'] as const satisfies readonly SpeechCapabilityName[];
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
