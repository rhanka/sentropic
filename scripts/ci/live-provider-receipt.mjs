import { readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function scheduleHealth(runs, { now = Date.now(), currentRun } = {}) {
  const latest = runs.filter(run => run.event === 'schedule' && String(run.id) !== String(currentRun)
    && (!run.display_title || run.display_title === 'Live provider qualification'))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!latest) return { healthy: false, reason: 'missing scheduled live run', lastRun: null, ageSeconds: null };
  const ageSeconds = (now - Date.parse(latest.created_at)) / 1000;
  return { healthy: Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds <= 26 * 3600
    && latest.status === 'completed' && latest.conclusion === 'success',
  lastRun: latest.id, conclusion: latest.conclusion, ageSeconds };
}

export function qualifiedMain(runs) {
  const run = runs.find(row => row.head_branch === 'main' && row.event === 'push'
    && row.status === 'completed' && row.conclusion === 'success'
    && ['test-api-unit-integration (ai', 'test-e2e (', 'e2e-vscode'].every(prefix =>
      row.jobs?.some(job => job.name.startsWith(prefix) && job.conclusion === 'success'))
    && ['publish-api-image', 'publish-ui-image'].every(name =>
      row.jobs?.some(job => job.name === name && job.conclusion === 'success'))
    && row.jobs.filter(job => job.name.startsWith('test-api-unit-integration (ai') && job.conclusion === 'success').length === 3
    && row.jobs.filter(job => job.name.startsWith('test-e2e (') && job.conclusion === 'success').length === 6);
  if (!run || !/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error('No complete qualified main tuple');
  return { sourceSha: run.head_sha, workflowSha: run.head_sha, run: run.id, attempt: run.run_attempt };
}

export function* readPages(readPage, key) {
  for (let page = 1; ; page++) {
    const next = readPage(page)[key];
    if (!Array.isArray(next)) throw new Error(`Missing GitHub page: ${key}`);
    yield* next;
    if (next.length < 100) return;
  }
}
export const readAllPages = (readPage, key) => [...readPages(readPage, key)];

export function liveReceipt({ tuple, selection, events, results, schedule, event }) {
  if (tuple.sourceSha !== selection.sourceSha || !/^sha256:[a-f0-9]{64}$/.test(tuple.api?.id)
    || !/^sha256:[a-f0-9]{64}$/.test(tuple.ui?.id) || !/^[a-f0-9]{64}$/.test(tuple.lockSha256)
    || !Object.keys(tuple.installedPackages ?? {}).length) {
    throw new Error('Incomplete or mismatched live application/package tuple');
  }
  const calls = events.filter(row => row.type === 'request');
  const outcomes = events.filter(row => ['response', 'error', 'cancelled'].includes(row.type));
  const qualified = ['api', 'browser', 'vscode'].every(lane => results[lane] === 0)
    && calls.length > 0 && outcomes.length === calls.length
    && outcomes.some(row => row.type === 'response' && row.status >= 200 && row.status < 400)
    && new Set(calls.map(row => row.requestId)).size === calls.length
    && calls.every(call => outcomes.filter(row => row.requestId === call.requestId).length === 1)
    && outcomes.every(row => row.type === 'cancelled' || row.type === 'response' && row.status >= 200 && row.status < 400);
  return { version: 1, tuple, selection, trigger: event, qualified,
    schedule, results, calls: calls.length, failedCalls: outcomes.filter(row => row.type === 'error' || row.status >= 400).length,
    cancelledCalls: outcomes.filter(row => row.type === 'cancelled').length,
    unfinishedCalls: calls.length - outcomes.length, costUsd: null, costStatus: 'to measure: runtime observations do not price provider calls',
    retryAttempts: null, retryStatus: 'to measure: wire attempts are counted without inferring logical retry identity' };
}

export function fixtureReceipt({ traffic, networkInternal, unexpectedEgress = [], requireCalls = false }) {
  const qualified = networkInternal && traffic.failedRequests === 0 && unexpectedEgress.length === 0
    && Number.isSafeInteger(traffic.calls) && traffic.calls >= (requireCalls ? 1 : 0);
  return { qualified, networkInternal, unexpectedEgress, traffic, requireCalls,
    liveProviderCalls: networkInternal ? 0 : null,
    proof: 'API test network has no external route; provider fetches are redirected locally' };
}

const json = file => JSON.parse(readFileSync(file, 'utf8'));
export function receiptFromDirectory(dir, { schedule, event } = {}) {
  const missing = ['selection.json', 'tuple.json', 'results.json', 'calls.jsonl'].filter(file => !existsSync(`${dir}/${file}`));
  if (missing.length) return { version: 1, qualified: false, trigger: event, schedule,
    failure: { stage: 'prepare-or-run', missing }, calls: null, costUsd: null, costStatus: 'to measure' };
  const events = readFileSync(`${dir}/calls.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return liveReceipt({ tuple: json(`${dir}/tuple.json`), selection: json(`${dir}/selection.json`),
    results: json(`${dir}/results.json`), events, schedule, event });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, dir = '.tmp/live-provider'] = process.argv.slice(2);
  mkdirSync(dir, { recursive: true });
  const api = route => JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8' }));
  const pages = (route, key) => readAllPages(page => api(`${route}?per_page=100&page=${page}`), key);
  if (command === 'select') {
    const runs = readPages(page => api(`repos/rhanka/sentropic/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100&page=${page}`), 'workflow_runs');
    let selected = false;
    for (const run of runs) {
      run.jobs = pages(`repos/rhanka/sentropic/actions/runs/${run.id}/jobs`, 'jobs');
      let selection;
      try { selection = qualifiedMain([run]); } catch { continue; }
      const artifacts = pages(`repos/rhanka/sentropic/actions/runs/${run.id}/artifacts`, 'artifacts');
      if (!['live-provider-api-identity', 'live-provider-ui-identity'].every(name => artifacts.some(row => row.name === name && !row.expired))) continue;
      writeFileSync(`${dir}/selection.json`, JSON.stringify(selection, null, 2));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${selection.sourceSha}\nrun=${selection.run}\n`);
      console.log(JSON.stringify(selection)); selected = true; break;
    }
    if (!selected) throw new Error('No complete qualified main tuple with retained application identities');
  } else if (command === 'tuple') {
    const selection = json(`${dir}/selection.json`);
    if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== selection.sourceSha) throw new Error('Live checkout differs from qualification');
    const image = name => { const row = json(`${dir}/${name}.json`)[0]; return { id: row.Id, digests: row.RepoDigests, tags: row.RepoTags }; };
    const declaredPackages = Object.fromEntries(readdirSync('packages').flatMap(name => {
      try { const pkg = json(`packages/${name}/package.json`); return [[pkg.name, pkg.version]]; } catch { return []; }
    }));
    const installedPackages = json(`${dir}/installed-packages.json`);
    for (const [name, spec] of Object.entries(json('api/package.json').dependencies)) {
      if (String(spec).startsWith('file:../packages/') && installedPackages[name] !== declaredPackages[name]) throw new Error(`Missing application workspace: ${name}`);
    }
    const applicationReceipts = { api: json('api-image.json'), ui: json('ui-image.json') };
    for (const kind of ['api', 'ui']) {
      if (applicationReceipts[kind].sourceSha !== selection.sourceSha || applicationReceipts[kind].imageId !== image(kind).id) {
        throw new Error(`Qualified application artifact differs: ${kind}`);
      }
    }
    for (const [name, version] of Object.entries(installedPackages)) {
      if (declaredPackages[name] && declaredPackages[name] !== version) throw new Error(`Installed tuple differs: ${name}`);
    }
    writeFileSync(`${dir}/tuple.json`, JSON.stringify({ sourceSha: selection.sourceSha, api: image('api'), ui: image('ui'),
      lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'), installedPackages, applicationReceipts }, null, 2));
  } else if (command === 'run') {
    if (!/^(test|e2e)-/.test(process.env.COMPOSE_PROJECT_NAME ?? '')) throw new Error('Live qualification requires an isolated Make environment');
    const invoke = args => spawnSync('make', [...args, 'API_PORT=9405', 'UI_PORT=5605',
      'MAILDEV_UI_PORT=1505', `ENV=${process.env.COMPOSE_PROJECT_NAME}`], { stdio: 'inherit' }).status ?? 1;
    writeFileSync(`${dir}/calls.jsonl`, '');
    chmodSync(`${dir}/calls.jsonl`, 0o666);
    const results = { api: 0, browser: 0, vscode: 0, spans: [] };
    const measured = (lane, args) => {
      const start = performance.now(); const status = invoke(args);
      results.spans.push({ lane, command: args, seconds: (performance.now() - start) / 1000, status });
      return status;
    };
    try {
      results.api = measured('api-startup', ['up-api-test-ci']);
      if (!results.api) for (const name of ['initiative-generation-async', 'initiative-generation-sync',
        'executive-summary-sync', 'executive-summary-auto', 'company-enrichment-sync', 'chat-tools',
        'chat-sync', 'documents-tool', 'comment-assistant', 'gw-native-qualification']) {
        if (measured('api', ['test-api-ai', `SCOPE=tests/ai/${name}.test.ts`])) results.api = 1;
      }
      invoke(['down-api-ci']);
      results.browser = measured('browser', ['test-e2e']);
      invoke(['down']);
      results.vscode = measured('vscode', ['test-e2e-vscode', 'E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts']);
    } finally {
      writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
      invoke(['down']);
    }
    if (results.api || results.browser || results.vscode) process.exitCode = 1;
  } else if (command === 'fixture') {
    const traffic = json(`${dir}/traffic.json`);
    const networkInternal = readFileSync(`${dir}/network-internal.txt`, 'utf8').trim() === 'true';
    const file = '.tmp/live-provider/unexpected-egress.jsonl';
    const unexpectedEgress = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const receipt = fixtureReceipt({ traffic, networkInternal, unexpectedEgress,
      requireCalls: process.env.CI_PROVIDER_REQUIRE_CALLS === '1' });
    writeFileSync(`${dir}/receipt.json`, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
    if (!receipt.qualified) process.exitCode = 1;
  } else if (command === 'health') {
    const runs = api('repos/rhanka/sentropic/actions/workflows/llm-live-daily.yml/runs?event=schedule&per_page=100').workflow_runs;
    const health = scheduleHealth(runs);
    console.log(JSON.stringify(health, null, 2));
    if (!health.healthy) process.exitCode = 1;
  } else if (command === 'finish') {
    let schedule;
    try {
      const runs = api('repos/rhanka/sentropic/actions/workflows/llm-live-daily.yml/runs?event=schedule&per_page=100').workflow_runs;
      schedule = scheduleHealth(runs, { currentRun: process.env.GITHUB_RUN_ID });
    } catch { schedule = { healthy: false, reason: 'schedule receipt API unavailable', lastRun: null }; }
    let receipt;
    try { receipt = receiptFromDirectory(dir, { schedule, event: process.env.GITHUB_EVENT_NAME }); }
    catch { receipt = { qualified: false, schedule, failure: { stage: 'receipt-validation' }, calls: null, costUsd: null }; }
    writeFileSync(`${dir}/receipt.json`, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
    // Schedule health is enforced by the independent hourly monitor. A manual
    // qualification never supplies evidence of an actual scheduled execution.
    if (!receipt.qualified) process.exitCode = 1;
  } else throw new Error('Expected select, tuple or finish');
}
