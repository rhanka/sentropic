// L3-E / L3-J (r6 §6.3, r4 §5): OperationModelMapV1 — the complete exact current
// product/CI operation map with I/D/N classification. Retired IDs refuse by exact
// match (no substring ban), the 2027-04-01T00:00:00Z cutoff is tested at the exact
// instant and the preceding instant, unmapped live operations refuse before send,
// and missing deployment/migration evidence leaves the whole case required/incomplete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HISTORICAL_IDS,
  NANO_CUTOFF_ISO,
  NANO_MODEL,
  RETIRED_IDS,
  assertModelAdmissible,
  loadOperationModelMap,
  operationEntry,
  validateOperationModelMap,
  type OperationModelMapV1,
} from '../src/operation-model-map.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const qualifiedFixture = (modelId: string): OperationModelMapV1 => ({
  schemaVersion: 1,
  mapId: 'OperationModelMapV1',
  generatedFrom: { head: 'H', base: 'B', tree: 'T' },
  productDefaultModel: NANO_MODEL,
  ciDefaultModel: 'mistral-small-2603',
  retiredIds: [...RETIRED_IDS],
  historicalIds: [...HISTORICAL_IDS],
  nanoModel: NANO_MODEL,
  nanoCutoffIso: NANO_CUTOFF_ISO,
  operations: [
    {
      operationId: 'product-chat', classification: 'intentional-live',
      sourceLocations: ['api/src/services/chat-service.ts:859'], provider: 'openai',
      modelId, endpoint: 'https://api.openai.com/v1/responses', runtime: 'api',
      capabilities: ['sync', 'stream'], requestBounds: 'bounded', responseBounds: 'bounded',
      qualifiedSeatRoutes: [modelId], deploymentEvidence: 'accepted',
    },
  ],
});

test('L3-E: the shipped OperationModelMapV1 loads, validates and binds the exact candidate H/B/T', () => {
  const map = loadOperationModelMap(repoRoot);
  assert.deepEqual(validateOperationModelMap(map), []);
  assert.equal(map.schemaVersion, 1);
  assert.equal(map.mapId, 'OperationModelMapV1');
  assert.match(map.generatedFrom.head, /^[0-9a-f]{40}$/);
  assert.match(map.generatedFrom.base, /^[0-9a-f]{40}$/);
  assert.match(map.generatedFrom.tree, /^[0-9a-f]{40}$/);
  assert.equal(map.productDefaultModel, 'gpt-5.4-nano');
  assert.equal(map.ciDefaultModel, 'mistral-small-2603');
  assert.deepEqual(map.retiredIds, ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14']);
});

test('L3-E: every operation entry carries class, source, provider, exact model, bounds and route state', () => {
  const map = loadOperationModelMap(repoRoot);
  const ids = map.operations.map(o => o.operationId);
  for (const expected of ['product-default', 'product-operations', 'api-ai-test-defaults', 'e2e-defaults', 'retired-id-occurrences', 'ci-seat-chat']) {
    assert.ok(ids.includes(expected), `operation ${expected} missing`);
  }
  assert.equal(new Set(ids).size, ids.length);
  for (const op of map.operations) {
    assert.match(op.classification, /^(intentional-live|incidental-deterministic|no-inference)$/);
    assert.ok(op.sourceLocations.length > 0, `${op.operationId}: source locations required`);
    assert.ok(op.provider.length > 0 && op.endpoint.length > 0);
    // An empty modelId is admissible only for an unqualified operation (no route,
    // source-gap evidence); a mapped operation must name its exact model.
    assert.ok(op.modelId.length > 0 || (op.qualifiedSeatRoutes.length === 0 && op.deploymentEvidence === 'source-gap'), `${op.operationId}: modelId required for a mapped operation`);
    // Bounds are always declared; capabilities are non-empty for every operation
    // that can actually infer — a no-inference entry honestly carries none.
    if (op.classification !== 'no-inference') assert.ok(op.capabilities.length > 0, `${op.operationId}: capabilities required`);
    assert.ok(op.requestBounds && op.responseBounds, `${op.operationId}: bounds required`);
    assert.ok(Array.isArray(op.qualifiedSeatRoutes));
    assert.match(op.deploymentEvidence, /^(source-gap|accepted|retired-exact-id)$/);
  }
});

test('L3-E: product and CI defaults map to the observed exact IDs without rewriting', () => {
  const map = loadOperationModelMap(repoRoot);
  assert.equal(operationEntry(map, 'product-default').modelId, 'gpt-5.4-nano');
  assert.equal(operationEntry(map, 'product-operations').modelId, 'gpt-5.4-nano');
  assert.equal(operationEntry(map, 'api-ai-test-defaults').modelId, 'mistral-small-2603');
  assert.equal(operationEntry(map, 'api-ai-test-defaults').classification, 'incidental-deterministic');
  assert.equal(operationEntry(map, 'e2e-defaults').modelId, 'mistral-small-2603');
  assert.equal(operationEntry(map, 'retired-id-occurrences').classification, 'no-inference');
});

test('L3-E: unknown or unmapped live operations refuse before send', () => {
  const map = loadOperationModelMap(repoRoot);
  assert.throws(() => operationEntry(map, 'unknown-operation'), /operation-unmapped/);
  assert.throws(() => assertModelAdmissible('gpt-5.4-nano', map, 'unknown-operation', Date.now()), /operation-unmapped/);
});

test('L3-E: missing deployment/migration evidence leaves the whole case required/incomplete', () => {
  const map = loadOperationModelMap(repoRoot);
  const product = operationEntry(map, 'product-default');
  assert.equal(product.deploymentEvidence, 'source-gap');
  assert.deepEqual(product.qualifiedSeatRoutes, []);
  const verdict = assertModelAdmissible('gpt-5.4-nano', map, 'product-default', Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(verdict.caseStatus, 'required-incomplete');
});

test('L3-J: both retired IDs refuse by exact match and no substring ban exists', () => {
  const map = qualifiedFixture(NANO_MODEL);
  for (const retired of RETIRED_IDS) {
    assert.throws(() => assertModelAdmissible(retired, map, 'product-chat', Date.parse('2026-11-01T00:00:00Z')), /model-retired/);
  }
  // A different ID containing the substring "nano" is NOT refused as retired; it
  // fails later as a mismatch/unqualified route instead — the ban is exact-ID only.
  assert.throws(() => assertModelAdmissible('gpt-4.1-nano-2', map, 'product-chat', Date.parse('2026-11-01T00:00:00Z')), /model-mismatch/);
  assert.throws(() => assertModelAdmissible('gpt-4.1-nano-2', map, 'product-chat', Date.parse('2026-11-01T00:00:00Z')), (e: Error) => !/model-retired/.test(e.message));
});

test('L3-J: historical Luna IDs confer no route authority', () => {
  const map = qualifiedFixture(NANO_MODEL);
  for (const historical of HISTORICAL_IDS) {
    assert.throws(() => assertModelAdmissible(historical, map, 'product-chat', Date.parse('2026-11-01T00:00:00Z')), /model-historical/);
  }
});

test('L3-J: the exact cutoff instant refuses gpt-5.4-nano, the preceding instant passes with valid receipts', () => {
  const map = qualifiedFixture(NANO_MODEL);
  const cutoffMs = Date.parse(NANO_CUTOFF_ISO);
  assert.equal(NANO_CUTOFF_ISO, '2027-04-01T00:00:00Z');
  assert.throws(() => assertModelAdmissible(NANO_MODEL, map, 'product-chat', cutoffMs), /model-cutoff/);
  assert.throws(() => assertModelAdmissible(NANO_MODEL, map, 'product-chat', cutoffMs + 1), /model-cutoff/);
  const before = assertModelAdmissible(NANO_MODEL, map, 'product-chat', cutoffMs - 1);
  assert.equal(before.model, NANO_MODEL);
  assert.equal(before.caseStatus, 'qualified');
});

test('L3-J: a different valid mapped ID passes; an unmapped model on a mapped operation refuses', () => {
  const map = qualifiedFixture('mistral-small-2603');
  const ok = assertModelAdmissible('mistral-small-2603', map, 'product-chat', Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(ok.caseStatus, 'qualified');
  assert.throws(() => assertModelAdmissible(NANO_MODEL, map, 'product-chat', Date.parse('2026-11-01T00:00:00Z')), /model-mismatch/);
});

test('L3-E/J: no CI-only alias — the mapped model is identical in product and CI contexts', () => {
  const map = loadOperationModelMap(repoRoot);
  const ci = operationEntry(map, 'ci-seat-chat');
  // The CI seat operation has no qualified route yet: it must refuse, never alias.
  assert.throws(() => assertModelAdmissible('gpt-5.4-nano', map, 'ci-seat-chat', Date.parse('2026-11-01T00:00:00Z')), /model-not-qualified-route|model-mismatch/);
  assert.deepEqual(ci.qualifiedSeatRoutes, []);
  assert.equal(ci.deploymentEvidence, 'source-gap');
});
