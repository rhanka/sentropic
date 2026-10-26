// Profile-to-artifact binding (r3 L3, P1-2). Resolves the model directory from
// the selected profile and hash-checks every file the engine loads before the
// worker reports ready. Any mismatch or missing file fails closed — a session
// can never run an unpinned or foreign model. Digests only, never audio.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { LocalSttProfile } from './profiles.js';

export class ModelDigestMismatchError extends Error {
  readonly code = 'model_digest_mismatch';
  constructor(
    readonly file: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`model artifact digest mismatch for ${file}`);
    this.name = 'ModelDigestMismatchError';
  }
}

/** Model directory entries in load order, paired with their pinned digest key. */
const MODEL_FILES = [
  ['model.bin', 'modelBin'],
  ['config.json', 'configJson'],
  ['tokenizer.json', 'tokenizerJson'],
  ['vocabulary.txt', 'vocabularyTxt'],
] as const;

/** Resolve the profile's model directory under a provisioned models root. */
export function resolveModelDir(profile: LocalSttProfile, modelsRoot: string): string {
  return path.join(modelsRoot, profile.model.modelDirName);
}

/** Relative path of the Silero VAD asset inside the pinned engine package. */
export const ENGINE_VAD_ASSET = 'assets/silero_vad_v6.onnx';

function sha256Hex(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Hash-check every file the engine loads from the model directory, plus the
 * engine-bundled VAD asset when its path is provided. Throws
 * ModelDigestMismatchError (or a missing-file error) before anything loads.
 */
export async function verifyModelDir(
  profile: LocalSttProfile,
  modelDir: string,
  vadAssetPath?: string,
): Promise<void> {
  for (const [fileName, digestKey] of MODEL_FILES) {
    const expected = profile.model.files[digestKey];
    const actual = sha256Hex(await readFile(path.join(modelDir, fileName)));
    if (actual !== expected) throw new ModelDigestMismatchError(fileName, expected, actual);
  }
  if (vadAssetPath !== undefined) {
    const expected = profile.model.vadDigest;
    const actual = sha256Hex(await readFile(vadAssetPath));
    if (actual !== expected) throw new ModelDigestMismatchError(ENGINE_VAD_ASSET, expected, actual);
  }
}
