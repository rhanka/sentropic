// Mandatory native gate; invoked with the retained material directory by materials.mk.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { replayDependencies } from './native-replay.mjs';

const execFileAsync = promisify(execFile);

test('should resolve the actual patched source offline and reject the OS-only source with fresh caches', async t => {
  assert.ok(process.env.SCANNER_MATERIALS, 'SCANNER_MATERIALS is required; this gate never skips');
  const work = await mkdtemp(join(tmpdir(), 'scanner-native-'));
  // The Go module cache is written read-only; restore write bits before cleanup.
  t.after(async () => {
    await execFileAsync('chmod', ['-R', 'u+w', work]).catch(() => {});
    await rm(work, { recursive: true, force: true });
  });
  const recipeBytes = await readFile(new URL('./recipe.json', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('./material-manifest.json', import.meta.url)));
  const result = await replayDependencies({ recipeBytes, manifest, destination: process.env.SCANNER_MATERIALS,
    workingDirectory: work });
  assert.equal(result.productionAdmitted, false);
  assert.equal(result.network, 'none');
  assert.equal(result.patchedGoJose, 'v4.1.6');
  assert.equal(result.osOnlyGoJose, 'v4.1.5');
  assert.equal(result.osOnlyRejected, true);
  assert.ok(result.modules > 1);
});
