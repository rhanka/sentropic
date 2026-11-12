import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { claimDead, claimRecovery, monoMs, readRecoveryClaim, releaseRecovery,
  runKubectl, loadState, saveState, utcNow } from './t3-lib.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
import { finishOpen } from './t3-finish-open.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOTAL_BUDGET_MS = 300_000;
export const COMMIT_CUTOFF_MS = 175_000;
export const FINISH_CUTOFF_MS = 205_000;
export const COMMIT_MARKER = 1793577600000;

// RBAC matrix, 50 (resource, verb) couples from the executed command set.
export const RBAC_MATRIX = [
  ['deployments', ['get', 'list', 'watch', 'patch', 'update']],
  ['deployments/scale', ['get', 'patch', 'update']],
  ['replicasets', ['get', 'list', 'patch']],
  ['statefulsets', ['get', 'list']],
  ['daemonsets', ['get', 'list']],
  ['pods', ['get', 'list', 'watch', 'create', 'delete']],
  ['pods/log', ['get']],
  ['pods/exec', ['create', 'get']],
  ['jobs', ['get', 'list', 'watch', 'create', 'delete']],
  ['cronjobs', ['get', 'list', 'patch']],
  ['configmaps', ['get', 'create', 'patch', 'update']],
  ['secrets', ['get', 'create', 'patch', 'delete']],
  ['persistentvolumeclaims', ['get', 'create', 'patch']],
  ['ingresses.networking.k8s.io', ['get', 'patch']],
  ['endpointslices.discovery.k8s.io', ['get', 'list']],
  ['middlewares.traefik.io', ['get', 'create', 'patch', 'delete']],
];
export const RBAC_COUNT = RBAC_MATRIX.reduce((n, [, verbs]) => n + verbs.length, 0);

export function loadSql(name) {
  return readFileSync(join(HERE, name), 'utf8');
}

export function hashRows(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Exact W8d probe URLs are operator inputs (qualified in P-0.4): the driver
// never invents OAuth scopes or redirect URIs.
export function buildProbes(config) {
  const endpoints = config.endpoints ?? {};
  const probes = [];
  if (endpoints.appHealth) probes.push({ id: 'S-3', url: endpoints.appHealth, expect: 200 });
  if (endpoints.idpConfig) probes.push({ id: 'S-4', url: endpoints.idpConfig, expect: 200 });
  if (endpoints.idpJwks) probes.push({ id: 'S-5', url: endpoints.idpJwks, expect: 200 });
  if (endpoints.s6Authorize) probes.push({ id: 'S-6', url: endpoints.s6Authorize, expect: 302, options: { redirect: 'manual' } });
  if (endpoints.appMe) probes.push({ id: 'S-7', url: endpoints.appMe, expect: 401 });
  if (endpoints.idpMe) probes.push({ id: 'S-8', url: endpoints.idpMe, expect: 401 });
  for (const [id, url] of [['S-9a', endpoints.emailApp], ['S-9b', endpoints.emailIdp]]) {
    if (url) probes.push({ id, url, expect: 200, options: { method: 'POST' } });
  }
  return { probes, externalProbes: config.externalProbes ?? [] };
}

export function splitSql(text) {
  const parts = {};
  let current = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^-- (Q[1-6]):/);
    if (m) { current = m[1]; parts[current] = ''; continue; }
    if (current && !line.startsWith('--')) parts[current] += `${line}\n`;
  }
  return parts;
}

// One delivered A4 entry point (execution.mjs / ops.mjs / run.mjs / verify.mjs)
// with file-path-only env, never secret values in argv.
export function delivered(ctx, script, env, timeoutMs) {
  const flat = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
  if (ctx.dryRun) { ctx.print(`# dry-run: ${flat} node ${script}`); return ''; }
  const res = spawnSync('node', [join(HERE, script)],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: timeoutMs });
  if (res.error || res.status !== 0) {
    throw new Error(`delivered_failed: ${script} ${(res.stderr ?? '').slice(0, 200)}`);
  }
  return res.stdout;
}

export function psql(ctx, statement, timeoutMs = 30_000) {
  if (ctx.dryRun && !ctx.probeReadOnly) {
    ctx.print(`# dry-run sql: ${statement.split('\n')[0]}...`);
    return '';
  }
  const started = monoMs();
  const out = ctx.call(['exec', ctx.postgresPod, '--',
    'psql', '-v', 'ON_ERROR_STOP=1', '-X', '-qAt'], statement);
  if (ctx.probeReadOnly) ctx.print(`# ${(monoMs() - started)}ms psql ${statement.split('\n')[0]}...`);
  return out;
}

// Classification: two cheap read-only round trips, no static reference to an
// optional relation (B2). Branch P needs committed AND apiReady; else U.
export function classify(ctx) {
  const sql = splitSql(loadSql('t3-classify.sql'));
  const q1 = psql(ctx, sql.Q1).trim().split('|');
  const journal = q1[0] === 't';
  const locks = Number(q1[1] ?? 0);
  let committed = false, receipts = 0;
  if (journal) {
    committed = psql(ctx, sql.Q2).trim() === 't';
    const hasAssetCol = psql(ctx, sql.Q3).trim() === 't';
    if (hasAssetCol) receipts = Number(psql(ctx, sql.Q4).trim() || 0);
  }
  let apiReady = false;
  try {
    const d = JSON.parse(ctx.call(['get', 'deployment', 'api', '-o', 'json']));
    const img = d.spec?.template?.spec?.containers?.find(c => c.name === 'api')?.image;
    apiReady = d.spec?.replicas === 1 && d.status?.readyReplicas === 1
      && d.status?.observedGeneration === d.metadata?.generation && img === ctx.config.candidateImage;
  } catch { apiReady = false; }
  return { journal, locks, committed, receipts, apiReady };
}

export function checkRbac(ctx) {
  if (ctx.dryRun && !ctx.probeReadOnly) {
    ctx.print(`# dry-run: ${RBAC_COUNT} kubectl auth can-i checks`);
    return;
  }
  for (const [resource, verbs] of RBAC_MATRIX) {
    for (const verb of verbs) {
      const out = ctx.call(['auth', 'can-i', verb, resource]);
      if (String(out).trim() !== 'yes') throw new Error(`rbac_denied: ${verb} ${resource}`);
    }
  }
}

const STEP_CUTOFFS = { W1: 25_000, W2: 35_000, W3: 50_000, W4: 70_000,
  W5: 110_000, W6: 125_000, W7a: 135_000, W7b: 175_000, W8: 205_000 };

// The watchdog kills only past the step's hard deadline: synchronous kubectl
// phases (W0 matrix, rollout waits) legitimately block heartbeats, so staleness
// alone is not a fault — staleness past the deadline is.
function heartbeat(ctx, state, step) {
  state.step = step;
  state.heartbeatMonoMs = monoMs();
  state.stepDeadlineMonoMs = state.t0MonoMs != null && STEP_CUTOFFS[step] != null
    ? state.t0MonoMs + STEP_CUTOFFS[step]
    : monoMs() + 600_000;
  saveState(ctx.stateDir, state);
}

// Recovery after any step failure, cutoff breach or driver fault. Re-reads
// the truth (never trusts the in-memory step) then rolls back pre-commit or
// converges post-commit. Returns the process exit code. The recovery claim
// keeps exactly one writer: the loser stands down with exit 5.
export async function recover(ctx, state, reason) {
  const me = ctx.recoverOwner ?? `pid-${process.pid}`;
  if (!claimRecovery(ctx.stateDir, me)) {
    const owner = readRecoveryClaim(ctx.stateDir);
    if (!claimDead(owner)) {
      ctx.print?.(`recovery stood down, owned by ${owner?.owner}`);
      return 5;
    }
    releaseRecovery(ctx.stateDir);
    if (!claimRecovery(ctx.stateDir, me)) return 5;
  }
  state.recoveryReason = reason;
  saveState(ctx.stateDir, state);
  const info = classify(ctx);
  state.commitVerified = info.committed;
  state.apiReady = info.apiReady;
  saveState(ctx.stateDir, state);
  if (!info.committed) {
    preCommitRollback({ call: ctx.call, revisions: ctx.config.revisions, preCmDir: ctx.config.preCmDir,
      dryRun: ctx.dryRun, note: ctx.print,
      zeroPodsTimeoutMs: ctx.probeReadOnly ? 10_000 : undefined });
    return 3;
  }
  const { probes, externalProbes } = buildProbes(ctx.config);
  await finishOpen({ call: ctx.call, probe: ctx.probe, state,
    save: next => saveState(ctx.stateDir, next), images: ctx.config.images, probes, externalProbes });
  return 4;
}

function baseEnv(ctx, extra = {}) {
  return { A4_TIER: ctx.tier, A4_KUBECONFIG_FILE: ctx.config.kubeconfigFile,
    A4_REQUEST_FILE: `${ctx.stateDir}/request.json`, A4_DRY_RUN: ctx.dryRun ? '1' : '0', ...extra };
}

// W0..W9 with hard per-step cutoffs measured from t0 (fence start). Any throw
// or cutoff breach routes to recover(); the watchdog covers driver death.
export async function drive(ctx) {
  const state = { version: 1, step: 'W0', startedAtUtc: utcNow(), driverPid: process.pid,
    namespace: ctx.config.namespace, middlewareSpec: ctx.config.middlewareSpec ?? null,
    stepDeadlineMonoMs: monoMs() + 600_000 };
  saveState(ctx.stateDir, state);
  try {
    return await driveInner(ctx, state);
  } catch (err) {
    return recover(ctx, state, `throw:${err.message}`);
  }
}

async function driveInner(ctx, state) {
  checkRbac(ctx);
  const t0 = monoMs();
  state.t0MonoMs = t0;
  const cutoff = ms => t0 + ms;
  const left = () => cutoff(TOTAL_BUDGET_MS) - monoMs();
  heartbeat(ctx, state, 'W1');
  ctx.d1 = (ctx.delivered ?? delivered)(ctx, 'execution.mjs', { ...baseEnv(ctx), A4_ACTION: 'fence',
    A4_AUTHORIZATION_FILE: ctx.config.authorizationFile,
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, Math.min(30_000, left()));
  if (monoMs() > cutoff(25_000)) return recover(ctx, state, 'W1_cutoff');
  heartbeat(ctx, state, 'W2');
  writeFileSync(`${ctx.stateDir}/request.json`, JSON.stringify(ctx.config.request), { mode: 0o600 });
  // B3: restrict only AFTER request.json exists (it asserts legacyWritersStopped).
  (ctx.delivered ?? delivered)(ctx, 'execution.mjs', { ...baseEnv(ctx), A4_ACTION: 'restrict',
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, Math.min(60_000, left()));
  {
    // Real runs fail closed here (restrict must have created it). Probes have
    // no fence, so absence is expected and recorded instead.
    let missing = false;
    try {
      const mwOut = ctx.call(['get', 'middleware', 'a4-verification', '-o', 'json']);
      const parsed = mwOut ? JSON.parse(mwOut).spec ?? null : null;
      if (parsed) {
        state.middlewareSpec = parsed;
        saveState(ctx.stateDir, state);
      } else missing = true;
    } catch {
      missing = true;
    }
    if (missing && !ctx.probeReadOnly) throw new Error('middleware_missing_after_restrict');
    if (missing) ctx.print('# probe: no a4-verification middleware (no fence in probe mode)');
  }
  state.storesSha256 = hashRows(psql(ctx, splitSql(loadSql('t3-classify.sql')).Q6));
  saveState(ctx.stateDir, state);
  if (monoMs() > cutoff(35_000)) return recover(ctx, state, 'W2_cutoff');
  heartbeat(ctx, state, 'W3');
  ctx.d3 = (ctx.delivered ?? delivered)(ctx, 'ops.mjs', { ...baseEnv(ctx), A4_OPERATION: 'wire',
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, Math.min(60_000, left()));
  if (monoMs() > cutoff(50_000)) return recover(ctx, state, 'W3_cutoff');
  for (const [step, script, env, at] of [
    ['W4', 'ops.mjs', { A4_OPERATION: 'custodian' }, 70_000],
    ['W5', 'run.mjs', { A4_PHASE: 'snapshot' }, 100_000],
    ['W6', 'run.mjs', { A4_PHASE: 'checkpoint' }, 125_000],
    ['W7a', 'execution.mjs', { A4_ACTION: 'delete-custodian' }, 135_000],
  ]) {
    heartbeat(ctx, state, step);
    (ctx.delivered ?? delivered)(ctx, script, { ...baseEnv(ctx), ...env,
      A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, Math.min(120_000, left()));
    if (step === 'W5') {
      (ctx.delivered ?? delivered)(ctx, 'ops.mjs', { ...baseEnv(ctx), A4_OPERATION: 'budgets',
        A4_BUDGETS_FILE: ctx.config.budgetsFile,
        A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, Math.min(60_000, left()));
      const now = hashRows(psql(ctx, splitSql(loadSql('t3-classify.sql')).Q6));
      if (now !== state.storesSha256) throw new Error('encrypted_stores_drift');
    }
    if (monoMs() > cutoff(at)) return recover(ctx, state, `${step}_cutoff`);
  }
  heartbeat(ctx, state, 'W7b');
  if (monoMs() > cutoff(COMMIT_CUTOFF_MS)) return recover(ctx, state, 'W7_cutoff');
  (ctx.delivered ?? delivered)(ctx, 'execution.mjs', { ...baseEnv(ctx), A4_ACTION: 'start-api',
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, Math.min(120_000, left()));
  const info = classify(ctx);
  state.commitVerified = info.committed;
  state.apiReady = info.apiReady;
  saveState(ctx.stateDir, state);
  heartbeat(ctx, state, 'W8');
  if (monoMs() > cutoff(FINISH_CUTOFF_MS)) return recover(ctx, state, 'W8_cutoff');
  const { probes, externalProbes } = buildProbes(ctx.config);
  await finishOpen({ call: ctx.call, probe: ctx.probe, state,
    save: next => saveState(ctx.stateDir, next), images: ctx.config.images, probes, externalProbes });
  if (monoMs() > cutoff(TOTAL_BUDGET_MS)) return recover(ctx, state, 'total_budget');
  state.step = 'DONE';
  state.heartbeatMonoMs = monoMs();
  saveState(ctx.stateDir, state);
  return 0;
}

function cliArg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

// Standalone entry: config file (0600) carries every input by path or value,
// never a secret on argv. Spawns the watchdog detached, then drives W0..W9.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const configPath = cliArg(argv, '--config');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const stateDir = cliArg(argv, '--state-dir');
  const dryRun = argv.includes('--dry-run');
  const probeReadOnly = argv.includes('--probe-readonly');
  const call = runKubectl({ kubeconfig: config.kubeconfigFile, namespace: config.namespace,
    dryRun, probeReadOnly, execIsReadOnly: probeReadOnly, print: console.log });
  const ctx = { call, config, stateDir, dryRun, probeReadOnly, tier: config.tier,
    postgresPod: config.postgresPod ?? 'postgres-0', probe: fetch, print: console.log };
  const watchdog = spawn('node', [join(HERE, 't3-watchdog.mjs'),
    '--state-dir', stateDir, '--config', configPath,
    ...(dryRun ? ['--dry-run'] : [])],
    { detached: true, stdio: 'ignore' });
  watchdog.unref();
  try {
    process.exitCode = await drive(ctx);
  } catch (err) {
    console.error(`driver_fatal: ${err.message}`);
    process.exitCode = 1;
  }
}
