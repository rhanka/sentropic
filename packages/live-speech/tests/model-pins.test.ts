// Profile-to-artifact binding tests (r3 L3, P1-2): the selected profile
// determines the loaded model directory, and every loaded file is hash-checked
// before use. Mismatch or missing files fail closed with no audio involved.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  ModelDigestMismatchError,
  resolveModelDir,
  verifyModelDir,
} from '../src/node/model-pins.js';
import { selectLocalSttProfile } from '../src/node/profiles.js';

const modelsRoot = fileURLToPath(new URL('./fixtures/models', import.meta.url));

async function fixtureDigests(dir: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const [file, key] of [
    ['model.bin', 'modelBin'],
    ['config.json', 'configJson'],
    ['tokenizer.json', 'tokenizerJson'],
    ['vocabulary.txt', 'vocabularyTxt'],
  ] as const) {
    const bytes = await readFile(path.join(dir, file));
    entries[key] = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  }
  return entries;
}

function profileWithDigests(digests: Record<string, string>) {
  const base = selectLocalSttProfile('local-tiny');
  return {
    ...base,
    profileId: 'local-tiny' as const,
    model: { ...base.model, modelDirName: 'fake-tiny', files: { ...base.model.files, ...digests } },
  };
}

describe('profile-to-artifact binding', () => {
  it('should resolve the model directory from the selected profile', () => {
    const profile = selectLocalSttProfile('local-tiny');
    expect(resolveModelDir(profile, '/models')).toBe(path.join('/models', 'faster-whisper-tiny'));
    expect(resolveModelDir(selectLocalSttProfile('local-base'), '/models')).toBe(
      path.join('/models', 'faster-whisper-base'),
    );
  });

  it('should accept a directory whose files match the profile pins', async () => {
    const dir = path.join(modelsRoot, 'fake-tiny');
    const profile = profileWithDigests(await fixtureDigests(dir));
    await expect(verifyModelDir(profile, dir)).resolves.toBeUndefined();
  });

  it('should fail closed on a digest mismatch without loading anything', async () => {
    const dir = path.join(modelsRoot, 'fake-tiny');
    const profile = profileWithDigests(await fixtureDigests(dir));
    const tampered = {
      ...profile,
      model: { ...profile.model, files: { ...profile.model.files, modelBin: `sha256:${'0'.repeat(64)}` } },
    };
    await expect(verifyModelDir(tampered, dir)).rejects.toThrow(ModelDigestMismatchError);
  });

  it('should fail closed on a missing model file', async () => {
    const dir = path.join(modelsRoot, 'fake-tiny');
    const profile = profileWithDigests(await fixtureDigests(dir));
    await expect(verifyModelDir(profile, path.join(modelsRoot, 'no-such-dir'))).rejects.toThrow();
  });
});
