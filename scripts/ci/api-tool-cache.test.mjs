import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from './image-receipt.mjs';
import { validateCache, verifyCache } from './api-tool-cache.mjs';

const hash = `sha256:${'a'.repeat(64)}`;
const expected = { schema: 1, ref: `registry/tools:tool-${'a'.repeat(64)}`, lockDigest: hash, architecture: 'linux/amd64' };
const receipt = { ...expected, imageId: hash, archiveDigest: hash };
test('should reject stale source, lock, schema, architecture and malformed image identities', () => {
  assert.equal(validateCache(receipt, expected), receipt);
  for (const key of Object.keys(expected)) assert.throws(() => validateCache({ ...receipt, [key]: 'different' }, expected), /mismatch/);
  for (const key of ['imageId', 'archiveDigest']) assert.throws(() => validateCache({ ...receipt, [key]: 'invalid' }, expected), /Invalid/);
});

test('should verify cached archive bytes before Docker loads them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tool-cache-'));
  try {
    writeFileSync(`${dir}/image.tar.zst`, 'toolbox bytes');
    const original = { ...receipt, archiveDigest: await digest(`${dir}/image.tar.zst`) };
    writeFileSync(`${dir}/cache.json`, JSON.stringify(original));
    assert.deepEqual(await verifyCache(dir, expected), original);
    writeFileSync(`${dir}/image.tar.zst`, 'corrupted bytes');
    await assert.rejects(verifyCache(dir, expected), /digest mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
