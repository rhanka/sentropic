import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveReceipt, scheduleHealth, qualifiedMain, receiptFromDirectory, readAllPages } from './live-provider-receipt.mjs';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';

const sourceSha = 'a'.repeat(40);
const tuple = { sourceSha, api: { id: `sha256:${'b'.repeat(64)}` }, ui: { id: `sha256:${'c'.repeat(64)}` },
  lockSha256: 'd'.repeat(64), installedPackages: { '@sentropic/llm-mesh': '1.0.0' } };
const input = { tuple, selection: { sourceSha, run: 1, attempt: 1 }, event: 'schedule',
  events: [{ type: 'request', requestId: '1' }, { type: 'response', requestId: '1', status: 200 }],
  results: { api: 0, browser: 0, vscode: 0 }, schedule: { healthy: true } };

test('should preserve exact live tuple, calls and unknown cost without inventing zero', () => {
  const receipt = liveReceipt(input);
  assert.equal(receipt.qualified, true);
  assert.equal(receipt.calls, 1);
  assert.equal(receipt.costUsd, null);
  assert.equal(receipt.retryAttempts, null);
  assert.deepEqual(receipt.tuple, tuple);
  assert.throws(() => liveReceipt({ ...input, tuple: { ...tuple, sourceSha: 'wrong' } }), /tuple/);
  assert.throws(() => liveReceipt({ ...input, tuple: { ...tuple, installedPackages: {} } }), /tuple/);
});

test('should expose failed, missing and unfinished live calls and suite failures', () => {
  for (const events of [[], input.events.slice(0, 1), [input.events[0], { type: 'error', requestId: '1' }],
    [input.events[0], { type: 'response', requestId: '1', status: 429 }]]) {
    assert.equal(liveReceipt({ ...input, events }).qualified, false);
  }
  assert.equal(liveReceipt({ ...input, results: { ...input.results, browser: 1 } }).qualified, false);
});

test('should retain expected cancellations separately from provider errors', () => {
  const receipt = liveReceipt({ ...input, events: [input.events[0], { type: 'cancelled', requestId: '1' }] });
  assert.equal(receipt.cancelledCalls, 1);
  assert.equal(receipt.failedCalls, 0);
  assert.equal(receipt.qualified, true);
});

test('should publish a failed receipt with unknown calls when preparation never completed', () => {
  mkdirSync('.tmp', { recursive: true });
  const dir = mkdtempSync('.tmp/br81-live-receipt-');
  try {
    const receipt = receiptFromDirectory(dir, { schedule: { healthy: false }, event: 'schedule' });
    assert.equal(receipt.qualified, false);
    assert.equal(receipt.calls, null);
    assert.ok(receipt.failure.missing.includes('tuple.json'));
  } finally { rmSync(dir, { recursive: true }); }
});

test('should report a missing, stale, cancelled or failed schedule independently of manual runs', () => {
  const now = Date.parse('2026-11-01T06:00:00Z');
  const scheduled = { id: 1, event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-10-31T06:00:00Z' };
  assert.equal(scheduleHealth([scheduled], { now }).healthy, true);
  for (const row of [{ ...scheduled, event: 'workflow_dispatch' }, { ...scheduled, conclusion: 'failure' },
    { ...scheduled, conclusion: 'cancelled' }, { ...scheduled, created_at: '2026-10-29T06:00:00Z' }]) {
    assert.equal(scheduleHealth([row], { now }).healthy, false);
  }
  assert.equal(scheduleHealth([], { now }).lastRun, null);
  assert.equal(scheduleHealth([scheduled], { now, currentRun: 1 }).healthy, false);
});

test('should select completed main application qualification rather than a partial or PR run', () => {
  const run = { id: 1, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_sha: sourceSha,
    jobs: [...Array.from({ length: 3 }, (_, i) => `test-api-unit-integration (ai, ${i})`),
      ...Array.from({ length: 6 }, (_, i) => `test-e2e (${i + 1})`), 'e2e-vscode',
      'publish-api-image', 'publish-ui-image'].map(name => ({ name, conclusion: 'success' })) };
  assert.equal(qualifiedMain([run]).sourceSha, sourceSha);
  for (const changed of [{ ...run, event: 'pull_request' }, { ...run, jobs: run.jobs.slice(0, 1) },
    { ...run, jobs: run.jobs.slice(0, -1) }, { ...run, status: 'in_progress' },
    { ...run, conclusion: 'failure' }]) assert.throws(() => qualifiedMain([changed]), /tuple/);
});

test('should retain application jobs and identities beyond the first GitHub page', () => {
  const rows = Array.from({ length: 205 }, (_, id) => ({ id }));
  assert.deepEqual(readAllPages(page => ({ jobs: rows.slice((page - 1) * 100, page * 100) }), 'jobs'), rows);
  assert.throws(() => readAllPages(() => ({}), 'artifacts'), /Missing GitHub page/);
});
