import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createKevAdapter, createKevQualificationDescriptor, createSystemOneLocalTransport,
  createDecisionService, KEV_INVENTORY, KEV_SERVED_MODEL_ID } from '../../packages/llm-mesh/dist/decision/host.js';
import { createProviderRegistry } from '../../packages/llm-mesh/dist/registry.js';

const cache = '/kev-cache';
const hostCache = process.env.KEV_CACHE_HOST;
assert(hostCache);
const pid = (await readFile(`${cache}/server-pid`, 'utf8')).trim();
assert(/^\d+$/.test(pid));
const token = (await readFile(`${cache}/api-key`, 'utf8')).trim();
const manifest = JSON.parse(await readFile(`${cache}/verified-manifest.json`, 'utf8'));
assert.equal(manifest.model.sha256, KEV_INVENTORY.model.sha256);
assert.equal(manifest.runtime.sha256, KEV_INVENTORY.runtime.archiveSha256);
const hashFile = async (file, signal) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024, signal })) hash.update(chunk);
  return hash.digest('hex');
};
const expectedArgs = [`${hostCache}/llama-b11954/llama-server`,
  '--model', `${hostCache}/${KEV_INVENTORY.model.file}`, '--alias', KEV_SERVED_MODEL_ID,
  '--host', '127.0.0.1', '--port', '8797', '--api-key-file', `${hostCache}/api-key`,
  '--ctx-size', '2048', '--parallel', '1', '--threads', '4', '--threads-batch', '4',
  '--batch-size', '512', '--ubatch-size', '512', '--n-gpu-layers', '0', '--no-warmup',
  '--no-context-shift', '--cache-ram', '0', '--no-webui'];
const verifyInventory = async (signal) => {
  assert.deepEqual((await readFile(`/kev-host-proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean), expectedArgs);
  const model = await stat(`${cache}/${KEV_INVENTORY.model.file}`);
  assert.equal(model.size, KEV_INVENTORY.model.bytes);
  const maps = await readFile(`/kev-host-proc/${pid}/maps`, 'utf8');
  assert(maps.split('\n').some((line) => line.endsWith(`${hostCache}/${KEV_INVENTORY.model.file}`)
    && line.trim().split(/\s+/)[4] === String(model.ino)));
  assert.equal(await hashFile(`${cache}/${KEV_INVENTORY.model.file}`, signal), KEV_INVENTORY.model.sha256);
  assert.equal(await hashFile(`${cache}/llama-b11954/llama-server`, signal), KEV_INVENTORY.runtime.serverSha256);
  assert.equal(await hashFile(`${cache}/llama-b11954/libllama-server-impl.so`, signal), KEV_INVENTORY.runtime.serverLibrarySha256);
  return KEV_INVENTORY;
};
const descriptor = createKevQualificationDescriptor(KEV_INVENTORY);
const adapter = createKevAdapter({ descriptor, transport: createSystemOneLocalTransport({ fetch, verifyInventory }) });
const receipts = [];
// Protocol smoke ledger only: process-local ports do not qualify deployment accounting.
const client = createDecisionService({ executionProfile: 'qualification', registry: createProviderRegistry([adapter]),
  resolveEvaluator: () => descriptor, evaluatorAllowlist: [descriptor.evaluator], authorize: () => true,
  resolveAuth: async () => ({ material: { type: 'environment-token', envVar: 'KEV_LOCAL_API_KEY', token },
    descriptor: { sourceType: 'environment-token' } }),
  resolvePrice: () => ({ providerId: 'local', modelId: descriptor.wireModel, protocol: 'systemone-local',
    authority: descriptor.priceProtocol.authority, priceRevision: descriptor.priceProtocol.revision,
    billingMode: 'call-rate', inputMicroUsdPerMtok: '0', outputMicroUsdPerMtok: '0', minimumMicroUsd: '100',
    identityMismatchPricing: 'requires-reconciliation' }),
  budget: { admit: async ({ callId }) => ({ ok: true, holdId: callId }),
    markDispatched: async () => ({ ok: true }), release: async () => {}, settle: async () => {} },
  receipts: { persist: async (receipt) => { receipts.push(receipt); } } });
const criteria = [
  { kind: 'binary', instructions: 'Is the provided statement about a cat?' },
  { kind: 'choice', instructions: 'Choose the animal mentioned.', options: [
    { id: 'cat', description: 'A cat' }, { id: 'dog', description: 'A dog' }] },
  { kind: 'graded', instructions: 'How clearly does the statement mention a cat?', direction: 'higher-is-better', levels: [
    { label: 'absent', description: 'No cat mentioned' }, { label: 'explicit', description: 'A cat is explicitly mentioned' }] },
];
const results = [];
for (const criterion of criteria) {
  const start = performance.now();
  const result = await client.decide({ schemaVersion: 1, evaluator: descriptor.evaluator,
    inputs: { output: 'The cat is sleeping on the sofa.' }, criterion, policy: { timeoutMs: 60000 } });
  results.push({ ...result, elapsedMs: performance.now() - start });
  await writeFile(`${cache}/smoke-results.json`, JSON.stringify({ status: 'experimental-protocol-only',
    inventory: KEV_INVENTORY, tariff: 'synthetic-accounting-fixture-not-measured-compute', results, receipts }, null, 2));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.servedModelId, KEV_SERVED_MODEL_ID);
  assert.equal(result.receipt.experimental, true);
  assert.equal(result.receipt.attempts, 1);
  assert.equal(result.receipt.usage.tokens.output.value, 0);
  console.log(`${criterion.kind}: verified native receipt; ${result.receipt.usage.tokens.input.value} input tokens`);
}
assert.equal(receipts.length, 3);
