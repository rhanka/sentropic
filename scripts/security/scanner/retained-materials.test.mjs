import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialFixture } from './contract-fixture.mjs';
import { retainMaterials, verifyRetainedMaterials } from './retained-materials.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'scanner-materials-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const contract = materialFixture();
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    const material = contract.manifest.materials.find(m => m.url === url);
    return new Response(contract.files[material.path]);
  };
  return { ...contract, destination: join(parent, 'retained'), parent, fetcher, calls };
}

test('should retain only the declared measured files and replay verification without fetching', async t => {
  const f = await fixture(t);
  assert.deepEqual(await retainMaterials(f), { contractValid: true, productionAdmitted: false });
  assert.equal(f.calls.length, f.manifest.materials.length);
  for (const material of f.manifest.materials) {
    assert.deepEqual(await readFile(join(f.destination, material.path)), f.files[material.path]);
  }
  assert.deepEqual(await verifyRetainedMaterials(f), { contractValid: true, productionAdmitted: false });
  assert.equal(f.calls.length, f.manifest.materials.length);
  await assert.rejects(retainMaterials(f), /scanner-contract/);
});

test('should refuse invalid pins before any fetch and leave no published directory', async t => {
  const f = await fixture(t);
  f.manifest.materials[0].digest = 'sha256:pending';
  await assert.rejects(retainMaterials(f), /scanner-contract/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(access(f.destination), { code: 'ENOENT' });
});

test('should refuse wrong, oversized, redirected and unavailable material without publishing partial files', async t => {
  for (const response of [
    () => new Response('wrong'),
    () => new Response('x'.repeat(1024)),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/source' } }),
    () => new Response(null, { status: 404 }),
  ]) {
    const f = await fixture(t);
    await assert.rejects(retainMaterials({ ...f, fetcher: async () => response() }), /scanner-contract/);
    await assert.rejects(access(f.destination), { code: 'ENOENT' });
  }
});

test('should refuse changed bytes, missing files, undeclared files and symlink substitutions on replay', async t => {
  for (const mutation of [
    async f => writeFile(join(f.destination, 'source.tar'), 'changed'),
    async f => rm(join(f.destination, 'source.tar')),
    async f => writeFile(join(f.destination, 'extra'), 'undeclared'),
    async f => { await rm(join(f.destination, 'source.tar'));
      await writeFile(join(f.parent, 'outside'), f.files['source.tar']);
      await symlink(join(f.parent, 'outside'), join(f.destination, 'source.tar')); },
  ]) {
    const f = await fixture(t); await retainMaterials(f); await mutation(f);
    await assert.rejects(verifyRetainedMaterials(f), /scanner-contract/);
  }
});
