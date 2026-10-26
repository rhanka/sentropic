// Independently pinned local STT profiles (r3 L3). Each profile carries its own engine
// version, model revision and model digest; the session loop never embeds a fixed model —
// the profile is selected by name at session start and an unknown name fails closed.

export type LocalSttModelId = 'tiny' | 'base';

export interface LocalSttModelPin {
  readonly modelId: LocalSttModelId;
  /** Owned engine package and pinned npm version (integrity recorded in the bench receipt). */
  readonly engine: 'faster-whisper-ts';
  readonly engineVersion: '1.2.1';
  /** Pinned model artifact revision (faster-whisper repo SHA at inspection R1). */
  readonly modelRevision: 'd2ee195a9a093a4e0cc81553beb2f8e6ced9ebb8';
  /** SHA-256 of the pinned model.bin consumed by the bench. */
  readonly modelDigest: string;
  /** SHA-256 of the Silero VAD model bundled with the engine. */
  readonly vadDigest: 'sha256:914fd98ac0a73d69ba1e70c9b1d66acb740eff90500dfde08b89a961b168a6a9';
}

export interface LocalSttProfile {
  readonly profileId: 'local-tiny' | 'local-base';
  readonly model: LocalSttModelPin;
  /** Capture rate for the whole local path; resampling happens once at the edge. */
  readonly sampleRateHz: 16000;
  /** Rolling decode window in seconds (spec §2.2 tunes 4–8 s by measurement). */
  readonly windowSec: number;
  /** Overlap between consecutive windows in seconds; deduped by stable-prefix commit. */
  readonly overlapSec: number;
  /** Decode cadence in seconds (spec §2.2 tunes 0.5–1 s by measurement). */
  readonly decodeCadenceSec: number;
  /** Short-utterance silence hangover in ms (spec §9 pins 500 ms). */
  readonly silenceHangoverMs: 500;
  /** Frame-energy speech gate in dBFS; silence below it never opens an utterance. */
  readonly energyThresholdDb: number;
}

const VAD_DIGEST = 'sha256:914fd98ac0a73d69ba1e70c9b1d66acb740eff90500dfde08b89a961b168a6a9' as const;
const MODEL_REVISION = 'd2ee195a9a093a4e0cc81553beb2f8e6ced9ebb8' as const;

export const LOCAL_STT_PROFILES: readonly LocalSttProfile[] = [
  {
    profileId: 'local-tiny',
    model: {
      modelId: 'tiny',
      engine: 'faster-whisper-ts',
      engineVersion: '1.2.1',
      modelRevision: MODEL_REVISION,
      modelDigest: 'sha256:dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1',
      vadDigest: VAD_DIGEST,
    },
    sampleRateHz: 16000,
    windowSec: 4,
    overlapSec: 1,
    decodeCadenceSec: 0.5,
    silenceHangoverMs: 500,
    energyThresholdDb: -45,
  },
  {
    profileId: 'local-base',
    model: {
      modelId: 'base',
      engine: 'faster-whisper-ts',
      engineVersion: '1.2.1',
      modelRevision: MODEL_REVISION,
      modelDigest: 'sha256:d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9',
      vadDigest: VAD_DIGEST,
    },
    sampleRateHz: 16000,
    windowSec: 6,
    overlapSec: 1.5,
    decodeCadenceSec: 1,
    silenceHangoverMs: 500,
    energyThresholdDb: -45,
  },
];

export class UnknownSpeechProfileError extends Error {
  readonly code = 'unknown_speech_profile';
  constructor(name: string) {
    super(`Unknown local STT profile: ${JSON.stringify(name)}`);
    this.name = 'UnknownSpeechProfileError';
  }
}

/** Select a profile by name. There is no default model: unknown names fail closed. */
export function selectLocalSttProfile(
  name: string,
  profiles: readonly LocalSttProfile[] = LOCAL_STT_PROFILES,
): LocalSttProfile {
  const found = profiles.find((profile) => profile.profileId === name);
  if (!found) throw new UnknownSpeechProfileError(name);
  return found;
}
