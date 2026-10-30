// Fixed allowlist of public evidence; never crawl operator homes or copy arbitrary logs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { digest } from './toolchain-contract.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { hashFile } from './toolchain-cache.mjs';
const inputs = '/evidence', output = '/receipts';
await mkdir(output, { recursive: true });
const index = [];
const groups = {};
async function retain(source, destination, decode = bytes => JSON.parse(bytes)) {
  const bytes = await readFile(`${inputs}/${source}`);
  const data = decode(bytes);
  const published = `${JSON.stringify(data)}\n`;
  const group = source.startsWith('main-40832206894/') ? `target-${source.split('/')[1].replace('-image', '')}`
    : source.startsWith('cosign-latest') || source.startsWith('verifier-latest') ? 'verifier-candidate'
    : source.startsWith('java-fixture/') ? 'java-control'
    : source.includes('self') ? 'self-scans'
    : source.startsWith('remote') || source.startsWith('rebuild') ? 'performance'
    : source.includes('iac') ? 'iac'
    : source.includes('-ci.') ? 'ci'
    : source.includes('failure') || source.includes('rollback') ? 'safety'
    : source.includes('ingestion') || source.includes('measurement') ? 'acquisition' : 'toolchain';
  const record = { source, sourceHash: digest(bytes), sourceBytes: bytes.length, value: data };
  (groups[group] ||= {})[destination] = record;
  index.push({ source, destination: `${group}.json#${destination}`, sourceHash: digest(bytes), sourceBytes: bytes.length,
    publishedValueHash: digest(published) });
}
for (const file of ['ingestion', 'java-measurement', 'checks-measurement', 'failure-trials',
  'scanner-self-report', 'verifier-self-report', 'iac-report', 'main-ci', 'green-main-ci', 'rollback-policy', 'remote-execution',
  'cosign-latest-release', 'trivy-latest-release', 'verifier-latest-report']) {
  await retain(`${file}.json`, `${file}.json`);
}
await retain('verifier-latest-inventory.jsonl', 'inventory.json');
for (const file of ['verifier-latest-offline.log', 'cosign-latest-buildinfo.txt']) await retain(file, `${file}.json`, bytes => ({ text: bytes.toString() }));
for (const file of ['remote', 'rebuild-probe', 'write-isolation']) await retain(`${file}.log`, `${file}.json`, bytes => ({ text: bytes.toString() }));
for (const file of ['index', 'manifest', 'config', 'trusted_root',
  'bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6']) {
  await retain(`${file}.json`, `${file}.json`);
}
for (const file of ['trivy-buildinfo', 'cosign-buildinfo', 'scanner-files', 'scanner-apk', 'offline-verification',
  'scanner-cold-pull.time', 'scanner-warm-pull.time', 'iac', 'scanner-self', 'verifier-self']) {
  const source = file.endsWith('.time') ? file : `${file}${['trivy-buildinfo', 'cosign-buildinfo', 'scanner-files', 'scanner-apk'].includes(file) ? '.txt' : '.log'}`;
  await retain(source, `${file}.json`, bytes => ({ text: bytes.toString() }));
}
for (const file of ['report.json', 'stderr.log', 'fixture.sha256']) {
  await retain(`java-fixture/${file}`, `java-${file.replace('.log', '.json').replace('.sha256', '-sha256.json')}`,
    bytes => file.endsWith('.json') ? JSON.parse(bytes) : { text: bytes.toString() });
}
for (const kind of ['api', 'api-tool', 'ui']) {
  const folder = `main-40832206894/${kind}-image`;
  const producer = JSON.parse(await readFile(`${inputs}/${folder}/${kind}-image.json`));
  const archiveManifest = JSON.parse(await readFile(`${inputs}/${folder}/archive-manifest.json`));
  const config = spawnSync('tar', ['-xOf', `${inputs}/${folder}/image.tar`, archiveManifest[0].Config], { maxBuffer: 1048576 });
  assert.equal(config.status, 0);
  assert.equal(digest(config.stdout), producer.imageId);
  const platform = JSON.parse(config.stdout);
  assert.equal(`${platform.os}/${platform.architecture}`, producer.architecture);
  (groups[`target-${kind}`] ||= {}).archiveIdentity = { archiveHash: await hashFile(`${inputs}/${folder}/image.tar`),
    configDigest: digest(config.stdout), platform: producer.architecture, sourceSha: producer.sourceSha };
  await retain(`${folder}/${kind}-image.json`, `${kind}-producer.json`);
  await retain(`${folder}/archive-manifest.json`, `${kind}-archive-manifest.json`);
  for (const temperature of ['cold', 'warm']) {
    for (const part of ['report', 'isolation', 'execution', 'state', 'stats']) {
      if (part === 'report') assert.equal(JSON.parse(await readFile(`${inputs}/${folder}/${temperature}-${part}.json`)).Metadata.ImageID, producer.imageId);
      await retain(`${folder}/${temperature}-${part}.json`, `${kind}-${temperature}-${part}.json`);
    }
    await retain(`${folder}/${temperature}-processes.txt`, `${kind}-${temperature}-processes.json`, bytes => ({ text: bytes.toString() }));
  }
  const registryPart = kind === 'api-tool' ? 'registry-error.log' : 'provenance-mismatch.json';
  await retain(`${folder}/${registryPart}`, `${kind}-registry.json`, bytes => kind === 'api-tool' ? { text: bytes.toString() } : JSON.parse(bytes));
}
for (const [name, data] of Object.entries(groups)) await writeFile(`${output}/${name}.json`, `${JSON.stringify(data)}\n`);
await writeFile(`${output}/files.json`, `${JSON.stringify({ schema: 1, observedAt: new Date().toISOString(),
  qualified: false, transformation: 'JSON minification only; text preserved as JSON strings; source hashes retained', files: index })}\n`);
console.log(JSON.stringify({ publishedFiles: index.length }));
