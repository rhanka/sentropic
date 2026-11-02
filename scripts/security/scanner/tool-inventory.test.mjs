import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { digest, policy } from '../daily/toolchain-contract.mjs';
import { TOOL_ROLES, validateToolInventory } from './tool-qualification.mjs';
import { toolFixture } from './tool-fixture.mjs';

const loadReal = async () => ({
  inventory: JSON.parse(await readFile(new URL('./tool-inventory.json', import.meta.url))),
  manifest: JSON.parse(await readFile(new URL('./material-manifest.json', import.meta.url))),
  recipe: JSON.parse(await readFile(new URL('./recipe.json', import.meta.url))),
});

const evidenceFiles = async () => Object.fromEntries(await Promise.all([
  ['verifierCandidate', 'docs/security/sec-s2b-qualify/verifier-candidate.json'],
  ['trustCustody', 'docs/security/sec5a-trust-custody.json'],
  ['selfScans', 'docs/security/sec-s2b-qualify/self-scans.json'],
].map(async ([name, file]) => [name, await readFile(new URL(`../../../${file}`, import.meta.url))])));

test('should validate the real tool inventory and cross-bind every exact pin', async () => {
  const real = await loadReal();
  const evidence = await evidenceFiles();
  const { inventory, unresolved } = validateToolInventory({ ...real, policy, evidenceFiles: evidence });
  assert.deepEqual([...inventory.roles.map(r => r.role)].sort(), TOOL_ROLES);
  assert.deepEqual(unresolved, ['uploader'], 'uploader digest stays pending the A08 reviewed workflow pin');
  const verifier = inventory.roles.find(r => r.role === 'verifier');
  assert.equal(verifier.digest, `sha256:${policy.signature.verifierCandidate.sha256}`);
  assert.equal(verifier.version, policy.signature.verifierCandidate.version);
  assert.equal(verifier.repository, policy.signature.verifierCandidate.repository);
  assert.equal(verifier.releaseImmutable, policy.signature.verifierCandidate.releaseImmutable);
  assert.equal(verifier.releaseAssetDigest, verifier.digest);
  for (const [role, kind] of [['acquisition', 'acquisition-tool'], ['sbom', 'sbom-tool']]) {
    const tool = inventory.roles.find(r => r.role === role);
    const material = real.manifest.materials.filter(m => m.kind === kind);
    assert.equal(material.length, 1);
    assert.equal(tool.materialPath, material[0].path);
    assert.equal(tool.digest, material[0].digest);
    assert.equal(tool.size, material[0].size);
    assert.equal(tool.url, material[0].url);
  }
  for (const tool of inventory.roles) {
    if (tool.url !== null && tool.role !== 'root-bootstrap') {
      assert.ok(real.recipe.origins.includes(new URL(tool.url).origin), tool.role);
    }
  }
  const root = inventory.roles.find(r => r.role === 'root-bootstrap');
  assert.ok(inventory.trustOrigins.includes(new URL(root.url).origin) && inventory.trustOrigins.includes(root.mirror));
  assert.equal(root.trustedRootDigest, root.digest);
  assert.ok(Date.parse(root.refreshBy) > Date.parse(root.observedAt));
  const uploader = inventory.roles.find(r => r.role === 'uploader');
  assert.deepEqual(uploader.destinationAllowlist, ['ghcr.io/rhanka/sentropic-trivy']);
  assert.equal(uploader.digest, null);
  assert.ok(uploader.pendingReason.length > 0);
  const bundle = JSON.parse((await evidenceFiles()).verifierCandidate.toString('utf8'));
  assert.equal(verifier.selfScaEvidence, bundle['verifier-latest-report.json'].sourceHash);
});

test('should refuse every mutation of the real inventory pins', async () => {
  const real = await loadReal();
  const evidence = await evidenceFiles();
  const run = inv => validateToolInventory({ ...real, inventory: inv, policy, evidenceFiles: evidence });
  const role = (inv, name) => inv.roles.find(r => r.role === name);
  for (const mutate of [
    inv => { role(inv, 'verifier').digest = 'sha256:pending'; },
    inv => { role(inv, 'verifier').digest = `sha256:${'g'.repeat(64)}`; },
    inv => { role(inv, 'verifier').version = 'latest'; },
    inv => { role(inv, 'verifier').size = 0; },
    inv => { role(inv, 'verifier').releaseAssetDigest = digest('other'); },
    inv => { role(inv, 'root-bootstrap').refreshBy = 'not-a-date'; },
    inv => { role(inv, 'root-bootstrap').tufRoles.root = `sha256:${'0'.repeat(64)}`; },
    inv => { role(inv, 'acquisition').digest = role(inv, 'sbom').digest; },
    inv => { role(inv, 'sbom').materialPath = 'tools/sbom/other.tar.gz'; },
    inv => { role(inv, 'uploader').destinationAllowlist = ['ghcr.io/rhanka/other']; },
    inv => { role(inv, 'uploader').digest = 'sha256:pending'; },
    inv => { role(inv, 'verifier').url = 'http://insecure.example/cosign'; },
    inv => { role(inv, 'sbom').url = 'https://evil.example/syft.tar.gz'; },
    inv => { inv.roles.pop(); },
    inv => { inv.roles.push(structuredClone(role(inv, 'verifier'))); },
    inv => { inv.trustOrigins = ['https://evil.example']; },
    inv => { inv.evidence.trustCustody = `sha256:${'0'.repeat(64)}`; },
    inv => { inv.status = 'admitted'; },
  ]) {
    const inv = structuredClone(real.inventory); mutate(inv);
    assert.throws(() => run(inv), /scanner-contract/, JSON.stringify(mutate));
  }
});

test('should refuse evidence references that do not bind the actual docs bytes', async () => {
  const real = await loadReal();
  const evidence = await evidenceFiles();
  const tampered = { ...evidence, selfScans: Buffer.from('tampered') };
  assert.throws(() => validateToolInventory({ ...real, policy, evidenceFiles: tampered }), /scanner-contract/);
  assert.throws(() => validateToolInventory({ ...real, policy, evidenceFiles: { ...evidence, selfScans: undefined } }), /scanner-contract/);
});

test('should validate a complete synthetic inventory with a resolved uploader', () => {
  const f = toolFixture();
  const { inventory, unresolved } = validateToolInventory(f);
  assert.deepEqual(unresolved, []);
  assert.equal(inventory.roles.find(r => r.role === 'uploader').digest.startsWith('sha256:'), true);
});

test('should refuse a synthetic inventory whose verifier pin disagrees with the policy', () => {
  const f = toolFixture();
  f.policy.signature.verifierCandidate.sha256 = 'f'.repeat(64);
  assert.throws(() => validateToolInventory(f), /scanner-contract/);
  const g = toolFixture();
  g.manifest.materials[0].digest = `sha256:${'e'.repeat(64)}`;
  assert.throws(() => validateToolInventory(g), /scanner-contract/);
});
