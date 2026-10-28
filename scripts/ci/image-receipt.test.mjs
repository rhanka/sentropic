import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { digest, validate } from './image-receipt.mjs';

const id = `sha256:${'a'.repeat(64)}`;
const expected = { schema: 1, kind: 'api', ref: 'registry/api:test', sourceSha: 'source',
  inputTree: 'tree', workflowDigest: id, runId: '42', architecture: 'linux/amd64',
  cacheScope: 'br78-v1-api-linux/amd64', profile: {} };
const receipt = { ...expected, imageId: id, archiveDigest: id, producer: { job: 'build-api-image', attempt: '1' } };

test('should accept an exact producer receipt', () => assert.equal(validate(receipt, expected), receipt));
for (const key of Object.keys(expected)) {
  test(`should reject missing or different ${key}`, () => {
    const missing = { ...receipt }; delete missing[key];
    assert.throws(() => validate(missing, expected), new RegExp(key));
    assert.throws(() => validate({ ...receipt, [key]: 'wrong' }, expected), new RegExp(key));
  });
}
for (const key of ['imageId', 'archiveDigest', 'producer']) {
  test(`should reject malformed ${key}`, () => {
    assert.throws(() => validate({ ...receipt, [key]: '' }, expected));
  });
}

test('should verify transported bytes and the loaded image before reuse', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'image-receipt-'));
  const cli = resolve('scripts/ci/image-receipt.mjs');
  const archive = join(scratch, 'image.tar.zst');
  const file = join(scratch, 'image.json');
  const run = (mode, env = {}) => execFileSync(process.execPath,
    [cli, mode, 'api', expected.ref, archive, file], { cwd: scratch, encoding: 'utf8',
      env: { ...process.env, PATH: `${scratch}:${process.env.PATH}`, GITHUB_RUN_ID: '42',
        GITHUB_JOB: 'build-api-image', GITHUB_RUN_ATTEMPT: '1', ...env }, stdio: 'pipe' });
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(scratch, '.github/workflows'), { recursive: true });
    writeFileSync(join(scratch, '.github/workflows/ci.yml'), 'workflow');
    writeFileSync(archive, 'transported bytes');
    writeFileSync(join(scratch, 'git'), `#!${process.execPath}\nconsole.log(process.argv.at(-1)==='HEAD'?'source':'tree');\n`, { mode: 0o755 });
    writeFileSync(join(scratch, 'docker'), `#!${process.execPath}\nconsole.log(process.env.TEST_IMAGE_ID || '${id}');\n`, { mode: 0o755 });
    run('write');
    assert.match(run('verify'), /Verified api/);
    assert.match(run('loaded'), /Verified api/);
    assert.throws(() => run('loaded', { TEST_IMAGE_ID: `sha256:${'b'.repeat(64)}` }), /Loaded image identity mismatch/);
    assert.throws(() => run('verify', { GITHUB_RUN_ID: '43' }), /runId/);
    writeFileSync(join(scratch, '.github/workflows/ci.yml'), 'different workflow');
    assert.throws(() => run('verify'), /workflowDigest/);
    writeFileSync(join(scratch, '.github/workflows/ci.yml'), 'workflow');
    writeFileSync(archive, 'tampered bytes');
    assert.throws(() => run('verify'), /Archive digest mismatch/);
    rmSync(file);
    assert.throws(() => run('verify'), /ENOENT/);
    assert.notEqual(await digest(archive), receipt.archiveDigest);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
