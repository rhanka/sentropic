import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfined, transferCandidate } from '../transfer.mjs';
it('refuses symlinked source members and different source commits before any destination write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-transfer-'));
  try {
    await writeFile(join(dir, 'file'), 'data');
    await symlink('file', join(dir, 'linked'));
    await assert.rejects(readConfined(dir, 'linked'), { code: 'unsafe-member' });
    await mkdir(join(dir, 'linked-parent'));
    await symlink('linked-parent', join(dir, 'parent'));
    await assert.rejects(readConfined(dir, 'parent/file'), { code: 'unsafe-member' });
    await assert.rejects(readConfined(dir, '../escape'), { code: 'bad-path' });
    await writeFile(join(dir, 'manifest.json'), '{"sourceSha":"old"}');
    await assert.rejects(transferCandidate({ manifestPath: join(dir, 'manifest.json'), sourceSha: 'new', worktree: join(dir, 'absent') }), { code: 'bad-source' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('copies exact non-secret pack bytes and writes the indexed input last', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-transfer-'));
  try {
    const payload = Buffer.from('{"name":"@sentropic/llm-mesh","version":"0.27.0"}');
    const header = Buffer.alloc(512); header.write('package/package.json'); header.write(payload.length.toString(8).padStart(11, '0'), 124); header.write('0', 156); header.fill(32, 148, 156); header.write(header.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    const bytes = gzipSync(Buffer.concat([header, payload, Buffer.alloc(512 - payload.length + 1024)]));
    const digest = (b) => createHash('sha256').update(b).digest('hex');
    const receipt = Buffer.from('{}');
    await mkdir(join(dir, 'receipts/mesh'), { recursive: true }); await mkdir(join(dir, 'companion/.github'), { recursive: true });
    await writeFile(join(dir, 'mesh.tgz'), bytes); await writeFile(join(dir, 'receipts/mesh/receipts.json'), receipt);
    const profiles = ['gateway-messaging', 'gateway-runtime'];
    const manifest = { kind: 'candidate', image: { reference: 'node:24-bookworm-slim', digest: 'a'.repeat(64) }, pythonFree: true, sourceSha: 'a'.repeat(40), contractSha256: 'b'.repeat(64), releaseLockSha256: 'c'.repeat(64), profiles,
      artifacts: [{ path: 'mesh.tgz', sha256: digest(bytes), size: bytes.length }, { path: 'receipts/mesh/receipts.json', sha256: digest(receipt), size: receipt.length }],
      packages: [{ name: '@sentropic/llm-mesh', version: '0.27.0', lockLocation: 'node_modules/@sentropic/llm-mesh', resolved: 'https://registry.npmjs.org/mesh.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, tarballSha256: digest(bytes), sourceIdentity: 'candidate:fixture' }],
      programCoverage: [{ program: 'gateway', phase: 'pr1-candidate', contractSha256: 'b'.repeat(64), profiles }] };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const result = await transferCandidate({ manifestPath: join(dir, 'manifest.json'), sourceSha: manifest.sourceSha, worktree: join(dir, 'companion'), program: 'gateway', delivery: 'pr1', mode: 'aggregate' });
    assert.deepEqual(await readFile(join(dir, 'companion', result.root, 'mesh.tgz')), bytes);
    assert.equal(JSON.parse(await readFile(join(dir, 'companion/.github/gateway-consumer-input.json'))).candidateBundle.bundleSha256, result.bundleSha256);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
