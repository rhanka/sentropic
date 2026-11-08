import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const launcher = new URL('../../k8s/overlays/preprod/a4-runtime/launch.mjs', import.meta.url).pathname;

test('should run the launcher when served through a ConfigMap-style ..data symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a4-runtime-'));
  try {
    symlinkSync(launcher, join(dir, 'real.mjs'));
    symlinkSync('real.mjs', join(dir, 'launch.mjs'));
    // Without HMAC custody the launcher must refuse loudly, proving its main block ran.
    const run = spawnSync(process.execPath, [join(dir, 'launch.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 20000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /hmac_composition_failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
