import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveReceipt, scheduleHealth, qualifiedMain, receiptFromDirectory, readAllPages, readPages, fixtureReceipt } from './live-provider-receipt.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
  const cancelled = [{ type: 'request', requestId: '2' }, { type: 'cancelled', requestId: '2' }];
  const receipt = liveReceipt({ ...input, events: [...input.events, ...cancelled] });
  assert.equal(receipt.cancelledCalls, 1);
  assert.equal(receipt.failedCalls, 0);
  assert.equal(receipt.qualified, true);
  assert.equal(liveReceipt({ ...input, events: cancelled }).qualified, false);
});

test('should require provider traffic for AI and VSCode while retaining non-provider browser journeys', () => {
  const input = { traffic: { calls: 1, failedRequests: 0 }, networkInternal: true, requireCalls: true };
  assert.equal(fixtureReceipt(input).qualified, true);
  assert.equal(fixtureReceipt(input).liveProviderCalls, 0);
  for (const changed of [{ networkInternal: false }, { traffic: { calls: 0, failedRequests: 0 } },
    { traffic: { calls: 1, failedRequests: 1 } }, { unexpectedEgress: [{ host: 'unexpected.example' }] }]) {
    assert.equal(fixtureReceipt({ ...input, ...changed }).qualified, false);
  }
  assert.equal(fixtureReceipt({ ...input, requireCalls: false, traffic: { calls: 0, failedRequests: 0 } }).qualified, true);
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

test('should retain fresh completed qualification while the next daily run is active without hiding failures', () => {
  const now = Date.parse('2026-11-01T06:00:00Z');
  const previous = { id: 1, event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-10-31T06:00:00Z' };
  for (const status of ['queued', 'in_progress']) {
    const active = { id: 2, event: 'schedule', status, conclusion: null, created_at: '2026-11-01T05:00:00Z' };
    const health = scheduleHealth([previous, active], { now });
    assert.equal(health.healthy, true);
    assert.equal(health.lastRun, 1);
    assert.equal(scheduleHealth([active], { now }).healthy, false);
    assert.equal(scheduleHealth([previous, active], { now: now + 3 * 3600_000 }).healthy, false);
    const failed = { ...previous, id: 3, conclusion: 'failure', created_at: '2026-11-01T04:00:00Z' };
    assert.equal(scheduleHealth([previous, failed, active], { now }).healthy, false);
    assert.equal(scheduleHealth([previous, failed, active], { now }).lastRun, 3);
  }
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

test('should search later workflow pages and stop fetching after the selected run', () => {
  const rows = Array.from({ length: 250 }, (_, id) => ({ id }));
  const pages = [];
  let selected;
  for (const row of readPages(page => {
    pages.push(page);
    return { workflow_runs: rows.slice((page - 1) * 100, page * 100) };
  }, 'workflow_runs')) if (row.id === 150) { selected = row.id; break; }
  assert.equal(selected, 150);
  assert.deepEqual(pages, [1, 2]);
});

test('should qualify all six browser shards on fresh state and retain any failed shard', () => {
  mkdirSync('.tmp', { recursive: true });
  const dir = realpathSync(mkdtempSync('.tmp/br81-live-run-'));
  try {
    writeFileSync(`${dir}/package.json`, '{"type":"commonjs"}');
    writeFileSync(`${dir}/make`, `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BR81_MAKE_LOG, JSON.stringify(args) + '\\n');
process.exit(args.includes('test-e2e') && args.includes('E2E_SHARD=' + process.env.BR81_FAIL_SHARD) ? 2 : 0);
`, { mode: 0o755 });
    for (const failedShard of ['', '3']) {
      const receiptDir = `${dir}/receipt-${failedShard || 'success'}`;
      const log = `${dir}/commands-${failedShard || 'success'}.jsonl`;
      const run = spawnSync(process.execPath, ['scripts/ci/live-provider-receipt.mjs', 'run', receiptDir], {
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
          COMPOSE_PROJECT_NAME: 'test-live-shards', BR81_MAKE_LOG: log, BR81_FAIL_SHARD: failedShard },
      });
      assert.equal(run.status, failedShard ? 1 : 0, run.stderr);
      const commands = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      const browsers = commands.filter(args => args.includes('test-e2e'));
      assert.equal(browsers.length, 6);
      assert.deepEqual(browsers.map(args => args.find(arg => arg.startsWith('E2E_SHARD='))),
        [1, 2, 3, 4, 5, 6].map(id => `E2E_SHARD=${id}`));
      assert.ok(browsers.every(args => args[0] === 'clean' && args[1] === 'test-e2e'));
      assert.equal(commands.filter(args => args[0] === 'test-api-ai').length, 10);
      assert.ok(commands.some(args => args.includes('SCOPE=tests/ai/gw-native-qualification.test.ts')));
      const vscode = commands.find(args => args.includes('test-e2e-vscode'));
      assert.deepEqual(vscode.slice(0, 2), ['clean', 'test-e2e-vscode']);
      assert.ok(commands.every(args => args.at(-1) === 'ENV=test-live-shards'
        && ['API_PORT=9405', 'UI_PORT=5605', 'MAILDEV_UI_PORT=1505'].every(port => args.includes(port))));
      const results = JSON.parse(readFileSync(`${receiptDir}/results.json`, 'utf8'));
      assert.equal(results.browser, failedShard ? 2 : 0);
      assert.equal(results.vscode, 0);
      assert.equal(results.spans.filter(span => span.lane === 'browser').length, 6);
      assert.equal(results.spans.filter(span => span.lane === 'browser' && span.status !== 0).length, failedShard ? 1 : 0);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
