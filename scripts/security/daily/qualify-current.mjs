// Authenticated current-main CI archives are distinct from canonical remote registry images.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { digest, policy } from './toolchain-contract.mjs';
import { hashFile } from './toolchain-cache.mjs';
import { prepareImageScan, validateComparison, validateImageReport } from './trivy.mjs';
const sourceSha = '2ea238790fe992cdbb8e0202b1a73a937b6a1793';
const base = '/evidence/main-40876641000';
const snapshots = JSON.parse(await readFile('/evidence/ingestion.json')).snapshots;
const jobs = JSON.parse(await readFile('/evidence/current-producers.json')).jobs;
const output = { observedAt: new Date().toISOString(), sourceSha, runId: '40876641000', qualified: false, targets: {} };
const json = async path => JSON.parse(await readFile(path));
for (const [kind, key, jobName] of [['api', 'api-production', 'build-api-image'],
  ['api-tool', 'api-toolbox', 'build-api-tool-image'], ['ui', 'ui-production', 'build-ui']]) {
  const folder = `${base}/${kind}-image`;
  const producerBytes = await readFile(`${folder}/${kind}-image.json`);
  const producer = JSON.parse(producerBytes);
  const job = jobs.find(value => value.name === jobName);
  assert.equal(job?.conclusion, 'success');
  assert.equal(job.head_sha, sourceSha);
  assert.equal(producer.sourceSha, sourceSha);
  assert.equal(producer.runId, output.runId);
  assert.equal(producer.producer.job, jobName);
  assert.equal(String(job.run_attempt), producer.producer.attempt);
  assert.equal(producer.architecture, policy.platform);
  assert.equal(producer.workflowDigest, digest(await readFile('/workspace/.github/workflows/ci.yml')));
  assert.equal(await hashFile(`${folder}/${kind}-image.tar.zst`), producer.archiveDigest);
  const archiveManifest = await json(`${folder}/archive-manifest.json`);
  assert.equal(archiveManifest.length, 1);
  const config = spawnSync('tar', ['-xOf', `${folder}/image.tar`, '--', archiveManifest[0].Config], { maxBuffer: 1048576 });
  assert.equal(config.status, 0);
  assert.equal(digest(config.stdout), producer.imageId);
  const parsedConfig = JSON.parse(config.stdout);
  assert.equal(`${parsedConfig.os}/${parsedConfig.architecture}`, policy.platform);
  const archive = { path: `${folder}/image.tar`, digest: await hashFile(`${folder}/image.tar`) };
  const ref = `urn:oci-archive:${archive.digest}`;
  const coldBytes = await readFile(`${folder}/cold-report.json`, 'utf8');
  const warmBytes = await readFile(`${folder}/warm-report.json`, 'utf8');
  const cold = JSON.parse(coldBytes);
  const expectedResults = cold.Results.map(value => `${value.Target}|${value.Class}|${value.Type}`).sort();
  const target = { key, ref, sourceSha, platform: policy.platform, configDigest: producer.imageId, expectedResults,
    provenance: { verified: true, sourceSha, imageRef: ref, platform: policy.platform, receiptHash: digest(producerBytes) } };
  const plan = await prepareImageScan({ target, sourceSha, key, snapshots, archive });
  const scans = {};
  for (const [temperature, bytes] of [['cold', coldBytes], ['warm', warmBytes]]) {
    const execution = await json(`${folder}/${temperature}-execution.json`);
    assert.equal(execution.exitCode, 0);
    validateImageReport(bytes, plan.target);
    assert.equal(JSON.parse(bytes).Trivy.Version, policy.version);
    scans[temperature] = { execution, rawHash: digest(bytes), report: JSON.parse(bytes),
      isolation: await json(`${folder}/${temperature}-isolation.json`) };
    assert.equal(scans[temperature].isolation[0].HostConfig.NetworkMode, 'none');
    assert.equal(scans[temperature].isolation[0].HostConfig.ReadonlyRootfs, true);
  }
  assert.deepEqual(scans.cold.isolation[0].Args, scans.warm.isolation[0].Args);
  const before = { ...plan, status: 0, rawHash: scans.cold.rawHash,
    parametersHash: digest(JSON.stringify(scans.cold.isolation[0].Args)) };
  await validateComparison(before, { ...before, rawHash: scans.warm.rawHash });
  let remote;
  try {
    const inspection = await json(`${folder}/registry-platform.json`);
    assert.equal(digest(Buffer.from(inspection.Raw, 'base64')), inspection.Descriptor.digest);
    remote = { manifestDigest: inspection.Descriptor.digest, configDigest: inspection.SchemaV2Manifest.config.digest,
      status: inspection.SchemaV2Manifest.config.digest === producer.imageId ? 'matched' : 'mismatch', inspection };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    remote = { status: 'unavailable', diagnostic: await readFile(`${folder}/registry-error.log`, 'utf8') };
  }
  output.targets[key] = { producer, producerReceiptHash: digest(producerBytes), job, archive,
    observedInventory: expectedResults, independentCompletenessAdmission: 'pending', comparisonAccepted: true,
    parametersHash: before.parametersHash, remote, scans };
}
await writeFile('/receipts/current-main.json', `${JSON.stringify(output)}\n`);
console.log(JSON.stringify({ sourceSha, targets: Object.keys(output.targets), qualified: false }));
