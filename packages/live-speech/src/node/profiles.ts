// Independently pinned local STT profiles (r3 L3). Each profile carries its own engine
// version, model origin/revision/license and per-file sha256 digests; the session loop
// never embeds a fixed model — the profile is selected by name at session start, the
// engine directory is resolved from the profile, and every loaded file is hash-checked
// before the worker reports ready. An unknown name fails closed.
//
// L3 endpoint VAD is the frame-energy gate below (energyThresholdDb): a chunk above
// the gate opens/continues an utterance, hangover silence closes it. The Silero asset
// digest pins the exact engine bundle for later device lots; Silero is not executed
// on the L3 path.
export type LocalSttModelId = 'tiny' | 'base';

export interface LocalSttModelFiles {
  readonly modelBin: string;
  readonly configJson: string;
  readonly tokenizerJson: string;
  readonly vocabularyTxt: string;
}

export interface LocalSttModelPin {
  readonly modelId: LocalSttModelId;
  /** Owned engine package and pinned npm version (integrity recorded in the bench receipt). */
  readonly engine: 'faster-whisper-ts';
  readonly engineVersion: '1.2.1';
  /** First-party model origin (Hugging Face repo). */
  readonly origin: string;
  /** Model repo revision the pinned files were taken from. */
  readonly modelRevision: string;
  readonly license: 'MIT';
  /** Model directory name under a provisioned models root. */
  readonly modelDirName: string;
  /** SHA-256 of every file the engine loads from the model directory. */
  readonly files: LocalSttModelFiles;
  /** SHA-256 of the Silero VAD asset bundled with the pinned engine (reserved use). */
  readonly vadDigest: 'sha256:914fd98ac0a73d69ba1e70c9b1d66acb740eff90500dfde08b89a961b168a6a9';
}

export interface LocalSttProfile {
  readonly profileId: 'local-tiny' | 'local-base';
  readonly model: LocalSttModelPin;
  /** Capture rate for the whole local path; resampling happens once at the edge. */
  readonly sampleRateHz: 16000;
  /** Rolling decode window in seconds (spec §2.2 tunes 4–8 s by measurement). */
  readonly windowSec: number;
  /** Overlap between consecutive windows in seconds; deduped by committed-text stitching. */
  readonly overlapSec: number;
  /** Decode cadence in seconds (spec §2.2 tunes 0.5–1 s by measurement). */
  readonly decodeCadenceSec: number;
  /** Short-utterance silence hangover in ms (spec §9 pins 500 ms). */
  readonly silenceHangoverMs: 500;
  /** Frame-energy speech gate in dBFS; silence below it never opens an utterance. */
  readonly energyThresholdDb: number;
  /** Forced endpoint bound: an utterance never accumulates beyond this duration. */
  readonly maxUtteranceSec: number;
}

const VAD_DIGEST = 'sha256:914fd98ac0a73d69ba1e70c9b1d66acb740eff90500dfde08b89a961b168a6a9' as const;
const TOKENIZER_DIGEST = 'sha256:fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab' as const;
const VOCABULARY_DIGEST = 'sha256:34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913' as const;

export const LOCAL_STT_PROFILES: readonly LocalSttProfile[] = [
  {
    profileId: 'local-tiny',
    model: {
      modelId: 'tiny',
      engine: 'faster-whisper-ts',
      engineVersion: '1.2.1',
      origin: 'https://huggingface.co/Systran/faster-whisper-tiny',
      modelRevision: 'd90ca5fe260221311c53c58e660288d3deb8d356',
      license: 'MIT',
      modelDirName: 'faster-whisper-tiny',
      files: {
        modelBin: 'sha256:dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1',
        configJson: 'sha256:a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8',
        tokenizerJson: TOKENIZER_DIGEST,
        vocabularyTxt: VOCABULARY_DIGEST,
      },
      vadDigest: VAD_DIGEST,
    },
    sampleRateHz: 16000,
    windowSec: 4,
    overlapSec: 1,
    decodeCadenceSec: 0.5,
    silenceHangoverMs: 500,
    energyThresholdDb: -45,
    maxUtteranceSec: 30,
  },
  {
    profileId: 'local-base',
    model: {
      modelId: 'base',
      engine: 'faster-whisper-ts',
      engineVersion: '1.2.1',
      origin: 'https://huggingface.co/Systran/faster-whisper-base',
      modelRevision: 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',
      license: 'MIT',
      modelDirName: 'faster-whisper-base',
      files: {
        modelBin: 'sha256:d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9',
        configJson: 'sha256:56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a',
        tokenizerJson: TOKENIZER_DIGEST,
        vocabularyTxt: VOCABULARY_DIGEST,
      },
      vadDigest: VAD_DIGEST,
    },
    sampleRateHz: 16000,
    windowSec: 6,
    overlapSec: 1.5,
    decodeCadenceSec: 1,
    silenceHangoverMs: 500,
    energyThresholdDb: -45,
    maxUtteranceSec: 30,
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
