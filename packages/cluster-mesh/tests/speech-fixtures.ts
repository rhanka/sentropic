import type { SpeechBinding, SpeechCapabilities, SpeechPlacement } from '@sentropic/llm-mesh/speech';
import { resolveSpeechProfiles, type SpeechProfileInput } from '../src/speech/config.js';
import type { SpeechProjectionContext } from '../src/speech/projection.js';

export const pcm = { codec: 'pcm16-le', sampleRateHz: 16000, channels: 1 } as const;
export const engine = (modelId = 'tiny', providerId = 'local',
  placement: SpeechPlacement = 'endpoint-native', adapterId = 'faster-whisper-ts'): SpeechBinding => ({
  modelId, providerId, placement, adapterId, modelRevision: 'pinned-model-r1', adapterRevision: '1.2.1',
  language: 'fr', ...(placement === 'cloud-relay' ? { accountRef: 'account:speech', region: 'eu' } :
    { resourceRef: 'resource:endpoint' }),
});
export const localTts = engine('espeak-fr', 'local', 'endpoint-native', 'espeak-ng');
export const capabilities = (binding: SpeechBinding): SpeechCapabilities => ({
  binding: { providerId: binding.providerId, modelId: binding.modelId, placement: binding.placement,
    modelRevision: binding.modelRevision, adapterId: binding.adapterId, adapterRevision: binding.adapterRevision },
  languages: ['fr', 'en'], regions: ['eu'], voices: ['voice:fr'],
  features: { streamingStt: 'supported', partialTranscript: 'supported', tts: 'supported',
    nativeDuplex: 'supported', serverVad: 'supported', clientVad: 'supported', manualCommit: 'supported',
    playoutTruncate: 'supported', toolCancellation: 'supported', resume: 'supported' },
  inputFormats: [pcm], outputFormats: [pcm], usageUnits: ['audio-seconds'],
});
export const profile = (profileId = 'A', stt = engine(), tts = localTts): SpeechProfileInput => ({
  schemaVersion: 1, profileId, configRevision: 'r1', tenantId: 'tenant:one', workspaceId: 'workspace:one',
  pipeline: 'chained', placement: 'endpoint-native', bindings: { stt, tts }, micMode: 'key',
  policyRef: 'policy:voice', egressPolicyRef: 'egress:voice', budgetRef: 'budget:qualification',
  allowedPlacements: ['endpoint-native', 'cloud-relay', 'browser-wasm', 'local-companion', 'cluster-hosted'],
  allowedEgress: ['device', 'cluster', 'provider'], requiredCapabilities: { stt: ['partialTranscript'] },
  inputFormats: [pcm], outputFormats: [pcm], maxDurationMs: 60000, maxCostUsd: 0.1,
});
export const primary = [
  profile('A'), profile('B', engine('base')),
  profile('C', engine('gpt-live-transcribe', 'openai', 'cloud-relay', 'openai-transcription')),
  profile('D', engine('gpt-realtime-whisper', 'openai', 'cloud-relay', 'openai-transcription')),
  profile('E', engine('voxtral-realtime-3', 'mistral', 'cloud-relay', 'mistral-transcription'),
    engine('voxtral-tts-3', 'mistral', 'cloud-relay', 'mistral-tts')),
  profile('cpp', engine('tiny', 'local', 'endpoint-native', 'whisper.cpp')),
];
export const catalogue = primary.flatMap((p) => Object.values(p.bindings).map(capabilities))
  .filter((entry, index, all) => all.findIndex((other) =>
    JSON.stringify(other.binding) === JSON.stringify(entry.binding)) === index);
export const context = (): SpeechProjectionContext => ({
  tenantId: 'tenant:one', workspaceId: 'workspace:one', policyRef: 'policy:voice',
  egressPolicyRef: 'egress:voice', budgetRef: 'budget:qualification', online: true,
  allowedPlacements: ['endpoint-native', 'cloud-relay', 'browser-wasm', 'local-companion', 'cluster-hosted'],
  allowedEgress: ['device', 'cluster', 'provider'], catalogue,
  inspectRoute: (binding) => ({ available: true, requiresNetwork: binding.placement === 'cloud-relay',
    egress: binding.placement === 'cloud-relay' ? 'provider' :
      binding.placement === 'cluster-hosted' ? 'cluster' : 'device' }),
});
export const select = (profileId = 'A', configRevision = 'r1', input = primary.find((p) => p.profileId === profileId)!) => ({
  profileId, configRevision, contentDigest: resolveSpeechProfiles([{ ...input, configRevision }])[0].contentDigest,
});
export const consent = (profileId = 'B', configRevision = 'r1') => ({
  ...select(profileId, configRevision), egressPolicyRef: 'egress:voice', consentRevision: 'consent:renewed',
});
