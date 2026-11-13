import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveReceipt, scheduleHealth, qualifiedMain, QUALIFIED_MAIN_SELECTOR, receiptFromDirectory, readAllPages, readPages, fixtureReceipt, GH_MAX_BUFFER, GH_PER_PAGE, GH_RUN_JQ, GH_JOB_JQ, GH_ARTIFACT_JQ, GH_SCHEDULE_JQ, ghApi, ghError } from './live-provider-receipt.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

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
  // networkInternal is recorded evidence only: an isolated Docker network
  // cannot serve host-side readiness probes or daily live egress.
  assert.equal(fixtureReceipt({ ...input, networkInternal: false }).qualified, true);
  assert.equal(fixtureReceipt({ ...input, networkInternal: false }).liveProviderCalls, null);
  for (const changed of [{ traffic: { calls: 0, failedRequests: 0 } },
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
    jobs: [...Array.from({ length: 3 }, (_, i) => `test-api-ai (ai-specs-${i})`),
      ...Array.from({ length: 6 }, (_, i) => `test-e2e (${i + 1})`), 'e2e-vscode',
      'publish-api-image', 'publish-ui-image'].map(name => ({ name, conclusion: 'success' })) };
  assert.equal(qualifiedMain([run]).sourceSha, sourceSha);
  for (const changed of [{ ...run, event: 'pull_request' }, { ...run, jobs: run.jobs.slice(0, 1) },
    { ...run, jobs: run.jobs.slice(0, -1) }, { ...run, status: 'in_progress' },
    { ...run, conclusion: 'failure' }]) assert.throws(() => qualifiedMain([changed]), /tuple/);
});

test('should select a tested-tree main run only through a green same-tree same-repository PR run', () => {
  const tree = 'e'.repeat(40);
  const repo = { full_name: 'rhanka/sentropic' };
  const lanes = [...Array.from({ length: 3 }, (_, i) => `test-api-ai (ai-specs-${i})`),
    ...Array.from({ length: 6 }, (_, i) => `test-e2e (${i + 1})`), 'e2e-vscode'].map(name => ({ name, conclusion: 'success' }));
  const pr = { id: 7, event: 'pull_request', status: 'completed', conclusion: 'success', workflow_id: 5,
    head_commit: { tree_id: tree }, head_repository: repo, repository: repo, jobs: lanes };
  const main = { id: 8, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_sha: sourceSha,
    workflow_id: 5, head_commit: { tree_id: tree }, repository: repo,
    jobs: [...lanes.map(job => ({ ...job, conclusion: 'skipped' })),
      ...['publish-api-image', 'publish-ui-image'].map(name => ({ name, conclusion: 'success' }))] };
  assert.throws(() => qualifiedMain([main]), /tuple/, 'skipped lanes alone never qualify');
  assert.deepEqual(qualifiedMain([{ ...main, qualifiedBy: pr }]),
    { sourceSha, workflowSha: sourceSha, run: 8, attempt: undefined, qualifiedBy: 7 });
  for (const changed of [{ ...pr, head_commit: { tree_id: 'f'.repeat(40) } }, { ...pr, head_repository: { full_name: 'fork/sentropic' } },
    { ...pr, conclusion: 'failure' }, { ...pr, event: 'push' }, { ...pr, workflow_id: 6 }, { ...pr, jobs: lanes.slice(1) }]) {
    assert.throws(() => qualifiedMain([{ ...main, qualifiedBy: changed }]), /tuple/, JSON.stringify(changed).slice(0, 80));
  }
  assert.throws(() => qualifiedMain([{ ...main, jobs: main.jobs.slice(0, -1), qualifiedBy: pr }]), /tuple/,
    'the main run still publishes both images itself');
});

test('should match the current AI and e2e job shapes on main so the daily selector finds a run', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const block = (id) => {
    const start = workflow.indexOf(`\n  ${id}:`);
    assert.ok(start !== -1, `missing job ${id} in ci.yml`);
    const rest = workflow.slice(start + 1);
    const next = rest.slice(id.length + 4).search(/\n  [A-Za-z0-9_-]+:/);
    return next === -1 ? rest : rest.slice(0, id.length + 4 + next);
  };
  const aiSpecs = [...block('test-api-ai').matchAll(/-\s*ai_specs:\s*"([^"]+)"/g)].map(match => match[1]);
  const e2eShards = [...block('test-e2e').matchAll(/-\s*shard:\s*(\d+)/g)].map(match => match[1]);
  assert.equal(aiSpecs.length, QUALIFIED_MAIN_SELECTOR.aiCount, 'AI shard count drifted from the daily selector');
  assert.equal(e2eShards.length, QUALIFIED_MAIN_SELECTOR.e2eCount, 'e2e shard count drifted from the daily selector');
  const run = { id: 7, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_sha: sourceSha,
    jobs: [...aiSpecs.map(specs => `test-api-ai (${specs})`), ...e2eShards.map(shard => `test-e2e (${shard})`),
      'e2e-vscode', 'publish-api-image', 'publish-ui-image'].map(name => ({ name, conclusion: 'success' })) };
  const matchedAi = run.jobs.filter(job => job.name.startsWith(QUALIFIED_MAIN_SELECTOR.aiPrefix)
    && job.conclusion === 'success').length;
  assert.ok(matchedAi > 0, 'daily selector matches zero AI jobs on the current workflow');
  assert.equal(qualifiedMain([run]).sourceSha, sourceSha);
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
      const overlay = `${receiptDir}/oauth-compose.json`;
      assert.deepEqual(JSON.parse(readFileSync(overlay, 'utf8')), { services: { api: { environment: {
        OAUTH_ISSUER_URL: 'http://localhost:9405', OAUTH_SERVICE_RESOURCE_URI: 'http://localhost:9405',
      } } } });
      assert.ok(commands.every(args => args.includes(`CI_PROVIDER_OVERLAY=-f docker-compose.ci-provider.yml -f ${overlay}`)));
      const browsers = commands.filter(args => args.includes('test-e2e'));
      assert.equal(browsers.length, 6);
      assert.deepEqual(browsers.map(args => args.find(arg => arg.startsWith('E2E_SHARD='))),
        [1, 2, 3, 4, 5, 6].map(id => `E2E_SHARD=${id}`));
      assert.ok(browsers.every(args => args[0] === 'clean' && args[1] === 'test-e2e'));
      assert.equal(commands.filter(args => args[0] === 'test-api-ai').length, 9);
      assert.ok(!commands.some(args => args.includes('SCOPE=tests/ai/gw-native-qualification.test.ts')),
        'operator-only UAT requires local session, listener and sourced payload evidence');
      const vscode = commands.find(args => args.includes('test-e2e-vscode'));
      assert.deepEqual(vscode.slice(0, 2), ['clean', 'test-e2e-vscode']);
      assert.ok(commands.every(args => args.at(-1) === 'ENV=test-live-shards'
        && ['API_PORT=9405', 'UI_PORT=5397', 'MAILDEV_UI_PORT=1505'].every(port => args.includes(port))));
      const results = JSON.parse(readFileSync(`${receiptDir}/results.json`, 'utf8'));
      assert.equal(results.browser, failedShard ? 2 : 0);
      assert.equal(results.vscode, 0);
      assert.equal(results.spans.filter(span => span.lane === 'browser').length, 6);
      assert.equal(results.spans.filter(span => span.lane === 'browser' && span.status !== 0).length, failedShard ? 1 : 0);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('should use a seeded exact OAuth callback origin in the workflow and every live browser command', () => {
  const seed = readFileSync('api/src/services/auth/oauth-client-seed.ts', 'utf8');
  const workflow = readFileSync('.github/workflows/llm-live-daily.yml', 'utf8');
  const port = workflow.match(/UI_PORT: '(\d+)'/)[1];
  assert.ok(seed.includes(`'http://localhost:${port}/auth/oauth/callback'`),
    `live UI port ${port} must be registered for example-mock-rp`);
});

test('should bound every GitHub response with an explicit maxBuffer and report the route on overflow', () => {
  assert.equal(GH_MAX_BUFFER, 512 * 1024);
  assert.equal(GH_PER_PAGE, 100);
  const route = 'repos/rhanka/sentropic/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100&page=1';
  const seen = [];
  const overflowingExec = (file, args, opts) => {
    seen.push([file, args, opts]);
    throw Object.assign(new Error('spawnSync gh ENOBUFS'), { code: 'ENOBUFS' });
  };
  assert.throws(() => ghApi(route, GH_RUN_JQ, { exec: overflowingExec }), /GitHub response for route .* exceeded 524288 bytes/);
  try {
    ghApi(route, GH_RUN_JQ, { exec: overflowingExec });
    assert.fail('expected an explicit overflow error');
  } catch (error) {
    assert.match(error.message, /exceeded 524288 bytes/);
    assert.ok(error.message.includes(route), 'the explicit error names the overflowing route');
    assert.match(error.message, /tighten --jq\/per_page/);
  }
  assert.equal(seen.length, 2);
  assert.equal(seen[0][0], 'gh');
  assert.ok(seen[0][1].includes('api') && seen[0][1].includes(route) && seen[0][1].includes('--jq'));
  assert.equal(seen[0][2].maxBuffer, GH_MAX_BUFFER);
  const passingExec = (file, args, opts) => {
    assert.equal(opts.maxBuffer, GH_MAX_BUFFER);
    return '{"workflow_runs":[]}';
  };
  assert.deepEqual(ghApi(route, GH_RUN_JQ, { exec: passingExec }), { workflow_runs: [] });
  let overflowed = false;
  try {
    execFileSync(process.execPath, ['-e', "console.log('x'.repeat(2 * 1024 * 1024))"], { encoding: 'utf8', maxBuffer: 1024 });
  } catch (error) {
    overflowed = true;
    const explicit = ghError(route, 1024, error);
    assert.match(explicit.message, /exceeded 1024 bytes/);
    assert.ok(explicit.message.includes(route));
  }
  assert.equal(overflowed, true, 'a payload larger than maxBuffer overflows instead of truncating');
  for (const [jq, needed, heavy] of [[GH_RUN_JQ,
    ['head_sha', 'head_commit', 'tree_id', 'repository', 'head_repository', 'workflow_id', 'run_attempt'],
    ['actor', 'triggering_actor', 'head_repository.html_url', 'repository.description']],
    [GH_JOB_JQ, ['name', 'conclusion'], ['steps', 'check_run_url']],
    [GH_ARTIFACT_JQ, ['name', 'expired'], ['workflow_run', 'archive_download_url']],
    [GH_SCHEDULE_JQ, ['display_title', 'created_at', 'conclusion'], ['actor', 'head_commit']]]) {
    for (const field of needed) assert.ok(jq.includes(field), `${jq.slice(0, 24)} projects ${field}`);
    for (const field of heavy) assert.ok(!jq.includes(field), `${jq.slice(0, 24)} drops heavy field ${field}`);
  }
});

test('should run select and health end to end against a stubbed gh with pagination, jq and explicit overflow', () => {
  mkdirSync('.tmp', { recursive: true });
  const dir = realpathSync(mkdtempSync('.tmp/br-select-e2e-'));
  const NL = String.fromCharCode(10);
  try {
    const binDir = dir + '/bin';
    mkdirSync(binDir, { recursive: true });
    const stub = binDir + '/gh';
    const stubLines = [
      '#!' + process.execPath,
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      'if (process.env.BR_SELECT_GH_LOG) fs.appendFileSync(process.env.BR_SELECT_GH_LOG, JSON.stringify(args) + String.fromCharCode(10));',
      "const route = args[1] || '';",
      "const query = (route.split('?')[1] || '').split('#')[0];",
      'const page = Number(new URLSearchParams(query).get(String.fromCharCode(112, 97, 103, 101)) || 1);',
      "const mode = process.env.BR_SELECT_STUB_MODE || 'success';",
      "const sourceSha = 'a'.repeat(40);",
      "if (mode === 'overflow' && route.includes('workflows/ci.yml/runs?branch=main')) {",
      '  fs.writeSync(1, JSON.stringify({ workflow_runs: [{ id: 1, padding: new Array(600 * 1024 + 1).join("x") }] }) + String.fromCharCode(10));',
      '  process.exit(0);',
      '}',
      "if (route.includes('/jobs')) {",
      "  const afterRuns = (route.split('/runs/')[1] || '').split('/')[0] || '0';",
      '  const id = Number(afterRuns);',
      "  if (id !== 1001) { console.log(JSON.stringify({ jobs: [] })); process.exit(0); }",
      "  const required = ['test-api-ai (ai-specs-0)', 'test-api-ai (ai-specs-1)', 'test-api-ai (ai-specs-2)', 'test-e2e (1)', 'test-e2e (2)', 'test-e2e (3)', 'test-e2e (4)', 'test-e2e (5)', 'test-e2e (6)', 'e2e-vscode', 'publish-api-image', 'publish-ui-image'].map(function (name) { return { name: name, conclusion: 'success' }; });",
      '  if (page === 1) {',
      '    const first = required.slice(0, 5);',
      '    const dummy = [];',
      '    for (let i = 0; i < 100 - first.length; i++) dummy.push({ name: "dummy-" + i, conclusion: "success" });',
      '    console.log(JSON.stringify({ jobs: first.concat(dummy) }));',
      '  } else if (page === 2) {',
      '    console.log(JSON.stringify({ jobs: required.slice(5) }));',
      '  } else {',
      '    console.log(JSON.stringify({ jobs: [] }));',
      '  }',
      '  process.exit(0);',
      '}',
      "if (route.includes('/artifacts')) {",
      '  if (page === 1) {',
      '    const dummy = [];',
      '    for (let i = 0; i < 99; i++) dummy.push({ name: "dummy-art-" + i, expired: true });',
      "    dummy.push({ name: 'live-provider-api-identity', expired: false });",
      '    console.log(JSON.stringify({ artifacts: dummy }));',
      '  } else if (page === 2) {',
      "    console.log(JSON.stringify({ artifacts: [{ name: 'live-provider-ui-identity', expired: false }] }));",
      '  } else {',
      '    console.log(JSON.stringify({ artifacts: [] }));',
      '  }',
      '  process.exit(0);',
      '}',
      "if (route.includes('event=pull_request')) { console.log(JSON.stringify({ workflow_runs: [] })); process.exit(0); }",
      "if (route.includes('workflows/ci.yml/runs?branch=main')) {",
      '  if (page === 1) {',
      '    const runs = [];',
      '    for (let i = 0; i < 100; i++) runs.push({ id: i + 1, head_branch: "main", event: "push", status: "completed", conclusion: "success", head_sha: "b".repeat(40), workflow_id: 5, run_attempt: 1, head_commit: { tree_id: "f".repeat(40) }, repository: { full_name: "rhanka/sentropic" }, head_repository: { full_name: "rhanka/sentropic" } });',
      '    console.log(JSON.stringify({ workflow_runs: runs }));',
      '  } else if (page === 2) {',
      "    console.log(JSON.stringify({ workflow_runs: [{ id: 1001, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_sha: sourceSha, workflow_id: 5, run_attempt: 1, head_commit: { tree_id: 'e'.repeat(40) }, repository: { full_name: 'rhanka/sentropic' }, head_repository: { full_name: 'rhanka/sentropic' } }] }));",
      '  } else {',
      '    console.log(JSON.stringify({ workflow_runs: [] }));',
      '  }',
      '  process.exit(0);',
      '}',
      "if (route.includes('llm-live-daily')) {",
      "  if (mode === 'empty-schedule') { console.log(JSON.stringify({ workflow_runs: [] })); process.exit(0); }",
      '  const created = new Date(Date.now() - 3600 * 1000).toISOString();',
      "  console.log(JSON.stringify({ workflow_runs: [{ id: 9, event: 'schedule', status: 'completed', conclusion: 'success', display_title: 'Live provider qualification', created_at: created }] }));",
      '  process.exit(0);',
      '}',
      'console.log(JSON.stringify({}));'
    ];
    writeFileSync(stub, stubLines.join(NL), { mode: 0o755 });
    const runCli = function (command, receiptDir, logFile, stubMode) {
      writeFileSync(logFile, '');
      return spawnSync(process.execPath, ['scripts/ci/live-provider-receipt.mjs', command, receiptDir], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { PATH: binDir + ':' + process.env.PATH, BR_SELECT_GH_LOG: logFile, BR_SELECT_STUB_MODE: stubMode, GITHUB_OUTPUT: dir + '/github-output.txt' })
      });
    };
    const receiptDir = dir + '/receipt';
    const selectLog = dir + '/gh-select.log';
    const selected = runCli('select', receiptDir, selectLog, 'success');
    assert.equal(selected.status, 0, selected.stderr);
    const selection = JSON.parse(readFileSync(receiptDir + '/selection.json', 'utf8'));
    assert.equal(selection.sourceSha, 'a'.repeat(40));
    assert.equal(selection.run, 1001);
    const calls = readFileSync(selectLog, 'utf8').trim().split(NL).filter(Boolean).map(JSON.parse);
    assert.ok(calls.length > 100, 'expected paginated gh calls, saw ' + calls.length);
    for (const callArgs of calls) {
      assert.ok(callArgs.includes('api'), 'every gh call uses api');
      assert.ok(callArgs.includes('--jq'), 'every gh call passes --jq');
    }
    const jqFor = function (fragment) {
      const hit = calls.find(function (callArgs) { return callArgs[1].includes(fragment); });
      assert.ok(hit, 'missing gh call for ' + fragment);
      return hit[hit.indexOf('--jq') + 1];
    };
    assert.equal(jqFor('branch=main'), GH_RUN_JQ);
    assert.equal(jqFor('/jobs'), GH_JOB_JQ);
    assert.equal(jqFor('/artifacts'), GH_ARTIFACT_JQ);
    const pagesSeen = function (fragment) {
      const seen = [];
      for (const callArgs of calls) {
        if (callArgs[1].includes(fragment)) {
          const q = (callArgs[1].split('?')[1] || '').split('#')[0];
          const p = new URLSearchParams(q).get(String.fromCharCode(112, 97, 103, 101));
          if (p && seen.includes(p) === false) seen.push(p);
        }
      }
      return seen.sort();
    };
    assert.deepEqual(pagesSeen('branch=main'), ['1', '2']);
    assert.deepEqual(pagesSeen('/runs/1001/jobs'), ['1', '2']);
    assert.deepEqual(pagesSeen('/runs/1001/artifacts'), ['1', '2']);
    const healthLog = dir + '/gh-health.log';
    const health = runCli('health', dir + '/health-receipt', healthLog, 'success');
    assert.equal(health.status, 0, health.stderr);
    assert.ok(health.stdout.includes('"healthy": true'), 'health reports healthy, saw ' + health.stdout.slice(0, 120));
    const healthCalls = readFileSync(healthLog, 'utf8').trim().split(NL).filter(Boolean).map(JSON.parse);
    const healthHasJq = healthCalls.some(function (callArgs) { return callArgs.includes('--jq') && callArgs[callArgs.indexOf('--jq') + 1] === GH_SCHEDULE_JQ; });
    assert.ok(healthHasJq, 'health passes the schedule jq projection');
    const overflowLog = dir + '/gh-overflow.log';
    const overflowed = runCli('select', dir + '/overflow-receipt', overflowLog, 'overflow');
    assert.notEqual(overflowed.status, 0, 'oversized GitHub response fails closed');
    const overflowText = String(overflowed.stdout) + String(overflowed.stderr);
    assert.ok(overflowText.includes('exceeded 524288 bytes'), 'overflow reports the explicit maxBuffer size, saw ' + overflowText.slice(0, 200));
    assert.ok(overflowText.includes('workflows/ci.yml/runs'), 'overflow names the overflowing route');
    const unhealthy = runCli('health', dir + '/unhealthy-receipt', dir + '/gh-unhealthy.log', 'empty-schedule');
    assert.notEqual(unhealthy.status, 0, 'missing schedule fails health');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
