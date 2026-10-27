import type { CapabilitySupport } from '../capabilities.js';
import type { SpeechAudioFormat, SpeechBinding, SpeechEngineIdentity } from './contracts.js';

export const speechCapabilityNames = [
  'streamingStt', 'partialTranscript', 'nativeDuplex', 'tts', 'serverVad',
  'clientVad', 'manualCommit', 'playoutTruncate', 'toolCancellation', 'resume',
] as const;
export type SpeechCapabilityName = (typeof speechCapabilityNames)[number];
export type SpeechUsageUnit = 'audio-seconds' | 'audio-tokens' | 'text-tokens' | 'characters' | 'session-seconds';

/** Evidence is specific to this adapter/model/placement tuple, never inherited. */
export interface SpeechCapabilities {
  readonly binding: SpeechEngineIdentity;
  /** Missing sets are unqualified; explicit selectors require membership evidence. */
  readonly languages?: readonly string[];
  readonly voices?: readonly string[];
  readonly regions?: readonly string[];
  readonly features: Readonly<Record<SpeechCapabilityName, CapabilitySupport>>;
  readonly inputFormats: readonly SpeechAudioFormat[];
  readonly outputFormats: readonly SpeechAudioFormat[];
  readonly usageUnits: readonly SpeechUsageUnit[];
}

export interface SpeechNegotiationRequest {
  readonly binding: SpeechBinding;
  readonly required: readonly SpeechCapabilityName[];
  readonly inputFormats?: readonly SpeechAudioFormat[];
  readonly outputFormats?: readonly SpeechAudioFormat[];
}

export type SpeechNegotiationResult =
  | { readonly ok: true; readonly binding: SpeechBinding;
      readonly inputFormat?: SpeechAudioFormat; readonly outputFormat?: SpeechAudioFormat }
  | { readonly ok: false; readonly reason: 'unavailable' | 'identity' }
  | { readonly ok: false; readonly reason: 'selector'; readonly selector: 'language' | 'voice' | 'region' }
  | { readonly ok: false; readonly reason: 'capability';
      readonly capability: SpeechCapabilityName; readonly support: CapabilitySupport }
  | { readonly ok: false; readonly reason: 'format'; readonly direction: 'input' | 'output' };

const bindingKeys = [
  'providerId', 'modelId', 'modelRevision', 'adapterId', 'adapterRevision', 'placement',
] as const satisfies readonly (keyof SpeechEngineIdentity)[];

const selectFormat = (
  offered: readonly SpeechAudioFormat[], requested: readonly SpeechAudioFormat[],
): SpeechAudioFormat | undefined => requested.find((wanted) =>
  wanted.channels === 1 && [16000, 24000, 48000].includes(wanted.sampleRateHz)
  && ['pcm16-le', 'opus'].includes(wanted.codec)
  && offered.some((format) => format.codec === wanted.codec
    && format.sampleRateHz === wanted.sampleRateHz && format.channels === wanted.channels));

/** Pure tuple/media check. Gateway admission and cluster configuration remain authoritative. */
export const negotiateSpeech = (
  capabilities: SpeechCapabilities | undefined, request: SpeechNegotiationRequest,
): SpeechNegotiationResult => {
  if (!capabilities) return { ok: false, reason: 'unavailable' };
  if (bindingKeys.some((key) => capabilities.binding[key] !== request.binding[key])) {
    return { ok: false, reason: 'identity' };
  }
  for (const [selector, supported] of [
    ['language', capabilities.languages], ['voice', capabilities.voices], ['region', capabilities.regions],
  ] as const) {
    const selected = request.binding[selector];
    if (selected !== undefined && !supported?.includes(selected)) {
      return { ok: false, reason: 'selector', selector };
    }
  }
  for (const capability of request.required) {
    const support = capabilities.features[capability] ?? 'unknown';
    if (support !== 'supported') return { ok: false, reason: 'capability', capability, support };
  }
  const inputFormat = request.inputFormats && selectFormat(capabilities.inputFormats, request.inputFormats);
  if (request.inputFormats && !inputFormat) return { ok: false, reason: 'format', direction: 'input' };
  const outputFormat = request.outputFormats && selectFormat(capabilities.outputFormats, request.outputFormats);
  if (request.outputFormats && !outputFormat) return { ok: false, reason: 'format', direction: 'output' };
  return { ok: true, binding: request.binding,
    ...(inputFormat ? { inputFormat } : {}), ...(outputFormat ? { outputFormat } : {}) };
};
