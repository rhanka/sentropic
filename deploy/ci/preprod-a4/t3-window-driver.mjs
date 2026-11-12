import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildProbes, claimDead, claimRecovery, monoMs, readRecoveryClaim, releaseRecovery,
  runKubectl, loadState, saveState, stepTimeoutMs, utcNow } from './t3-lib.mjs';
import { ROTATED_KEYS, preCommitRollback, waitZeroPods } from './t3-rollback.mjs';
import { ensureStarted, finishOpen } from './t3-finish-open.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOTAL_BUDGET_MS = 300_000;
export const COMMIT_CUTOFF_MS = 175_000;
export const FINISH_CUTOFF_MS = 300_000;
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

// The classifier SQL is a test asset under api/tests/api so the vitest that
// plays it against a migrated DB resolves it inside the CI api image, which
// ships api/ but never deploy/. The driver (full checkout) reads the same file.
const CLASSIFY_SQL_URL = new URL('../../../api/tests/api/t3-classify.sql', import.meta.url);
export function loadSql(name) {
  if (name !== 't3-classify.sql') throw new Error(`unknown sql asset: ${name}`);
  return readFileSync(CLASSIFY_SQL_URL, 'utf8');
}

export function hashRows(text) {
  return createHash('sha256').update(text).digest('hex');
}

// buildProbes lives in t3-lib.mjs so the standalone finish-open CLI shares
// the exact endpoint-to-probe mapping without a driver import cycle.
export { buildProbes };

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
  try {
    if (ctx.stateDir) {
      const cur = loadState(ctx.stateDir);
      if (cur) { cur.childPid = process.pid; saveState(ctx.stateDir, cur); }
    }
  } catch { /* observability only */ }
  const res = spawnSync('node', [join(HERE, script)],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: timeoutMs });
  try {
    if (ctx.stateDir) {
      const cur = loadState(ctx.stateDir);
      if (cur) { cur.childPid = res?.pid ?? null; saveState(ctx.stateDir, cur); }
    }
  } catch { /* observability only */ }
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
  // Explicit role: exec lands as OS root, which has no DB role (trust auth
  // admits the existing app role without a password).
  const out = ctx.call(['exec', ctx.postgresPod, '--',
    'psql', '-U', ctx.postgresUser ?? 'app', '-v', 'ON_ERROR_STOP=1', '-X', '-qAt'], statement);
  if (ctx.probeReadOnly) ctx.print(`# ${(monoMs() - started)}ms psql ${statement.split('\n')[0]}...`);
  return out;
}

// Classification: cheap read-only round trips, no static reference to an
// optional relation (B2). Q1 (locks) and Q5 (artifact relations) are always
// read; the caller must verify locks === 0 before trusting committed.
export function classify(ctx) {
  const sql = splitSql(loadSql('t3-classify.sql'));
  const q1 = psql(ctx, sql.Q1).trim().split('|');
  const journal = q1[0] === 't';
  const locks = Number(q1[1] ?? 0);
  let committed = false, receipts = 0;
  const relations = [];
  if (journal) {
    committed = psql(ctx, sql.Q2).trim() === 't';
    const hasAssetCol = psql(ctx, sql.Q3).trim() === 't';
    if (hasAssetCol) receipts = Number(psql(ctx, sql.Q4).trim() || 0);
    const q5 = psql(ctx, sql.Q5).trim();
    for (const line of q5 ? q5.split('\n') : []) {
      const [name, flag] = line.split('|');
      if (name) relations.push({ name, present: flag === 't' });
    }
  }
  let apiReady = false;
  try {
    const d = JSON.parse(ctx.call(['get', 'deployment', 'api', '-o', 'json']));
    const img = d.spec?.template?.spec?.containers?.find(c => c.name === 'api')?.image;
    apiReady = d.spec?.replicas === 1 && d.status?.readyReplicas === 1
      && d.status?.observedGeneration === d.metadata?.generation && img === ctx.config.candidateImage;
  } catch { apiReady = false; }
  return { journal, locks, committed, receipts, apiReady, relations };
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

// Hard per-step cutoffs from the fence start (t0). W8 and W9 share the total
// budget: once start-api has run, only the 300 s fence-to-open contract can
// still kill the driver — never an earlier W8 deadline inside finishOpen.
export const STEP_CUTOFFS = { W1: 25_000, W2: 35_000, W3: 50_000, W4: 70_000,
  W5: 110_000, W6: 125_000, W7a: 135_000, W7b: 175_000, W8: 300_000, W9: 300_000 };

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
  if (ctx.timeoutRef) ctx.timeoutRef.deadlineMs = state.stepDeadlineMonoMs;
}

// Recovery after any step failure, cutoff breach or driver fault. Re-reads
// the truth (never trusts the in-memory step) then rolls back pre-commit or
// converges post-commit. Returns the process exit code. The recovery claim
// keeps exactly one writer: the loser stands down with exit 5.
let RECOVERY_IN_FLIGHT = false;
export async function recover(ctx, state, reason) {
  // In-process single-flight: a second concurrent recover() (overlapping
  // watchdog ticks, or a drive() catch racing the watchdog) stands down
  // instead of running a second recovery in parallel.
  if (RECOVERY_IN_FLIGHT) {
    ctx.print?.('recovery stood down, already in flight');
    return 5;
  }
  const me = ctx.recoverOwner ?? `pid-${process.pid}`;
  // The watchdog claims before calling: the same owner holding a live claim
  // proceeds without re-claiming. Anything else must win the claim.
  const held = readRecoveryClaim(ctx.stateDir);
  if (!(held && held.owner === me && !claimDead(held))) {
    if (!claimRecovery(ctx.stateDir, me)) {
      const owner = readRecoveryClaim(ctx.stateDir);
      if (!claimDead(owner)) {
        ctx.print?.(`recovery stood down, owned by ${owner?.owner}`);
        return 5;
      }
      releaseRecovery(ctx.stateDir);
      if (!claimRecovery(ctx.stateDir, me)) return 5;
    }
  }
  RECOVERY_IN_FLIGHT = true;
  try {
    // The step deadline that armed this recovery is already expired: every
    // kubectl after this point would be capped to 1000 ms by
    // effectiveTimeout and fail the rollback. Re-arm the timeout budget to
    // the fence total so recovery kubectl calls keep usable timeouts.
    if (ctx.timeoutRef) {
      ctx.timeoutRef.deadlineMs = state.t0MonoMs != null
        ? state.t0MonoMs + TOTAL_BUDGET_MS
        : monoMs() + 120_000;
      state.stepDeadlineMonoMs = ctx.timeoutRef.deadlineMs;
    }
    state.recoveryReason = reason;
    try {
      const cur = loadState(ctx.stateDir);
      if (cur) { cur.childPid = process.pid; saveState(ctx.stateDir, cur); }
    } catch { /* observability only */ }
    saveState(ctx.stateDir, state);
    // Freeze writers BEFORE reading the truth: the commit transaction can
    // land between classify() and the scale-down, which would fork the
    // recovery onto an already-committed database while rolling the code
    // back. The wait is scoped to api: frontals may already run (W8).
    ctx.print?.('# recover: stopping api before classify');
    try {
      ctx.call(['scale', 'deployment/api', '--replicas=0']);
    } catch (err) {
      ctx.print?.(`# scale api 0 failed: ${err.message}`);
    }
    waitZeroPods(ctx.call, monoMs() + 40_000, ['api']);
    let info;
    if (ctx.dryRun && !ctx.probeReadOnly) {
      // Pure dry-run executes nothing, not even reads: simulate the
      // committed branch so the printed plan covers the nominal W8 opening.
      ctx.print?.('# dry-run: simulated classify (committed, api ready)');
      info = { journal: true, locks: 0, committed: true, receipts: 1, apiReady: true, relations: [] };
    } else {
      info = classify(ctx);
      // PostgreSQL purges the backend of the killed api pod asynchronously:
      // wait briefly for the advisory lock to drain instead of aborting the
      // automatic recovery on the first locked read (same budget as the
      // emergency classifier).
      const waitStart = monoMs();
      const waitBudget = ctx.lockWaitMs ?? 60_000;
      while (info.locks > 0 && monoMs() - waitStart < waitBudget) {
        ctx.print?.(`# recover: migration lock held (${info.locks}), waiting for backend drain`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        info = classify(ctx);
      }
    }
    state.commitVerified = info.committed;
    state.apiReady = info.apiReady;
    state.locks = info.locks;
    state.receipts = info.receipts;
    state.relations = info.relations;
    saveState(ctx.stateDir, state);
    if (info.locks > 0) throw new Error(`migration_locks_held: ${info.locks}`);
    // Q5 is observability, not a gate: a missing artifact relation is
    // unexpected on a migrated database, so record it and warn loudly
    // instead of deciding blind.
    const missingRelations = info.relations.filter(r => !r.present);
    if (missingRelations.length > 0) {
      ctx.print?.(`# recover: missing artifact relations: ${missingRelations.map(r => r.name).join(',')}`);
    }
    if (!info.committed) {
      await preCommitRollback({ call: ctx.call, revisions: ctx.config.revisions, preCmDir: ctx.config.preCmDir,
        dryRun: ctx.dryRun, note: ctx.print, probe: ctx.probe,
        healthUrl: ctx.config.endpoints?.appHealth, jwksUrl: ctx.config.endpoints?.idpJwks,
        witness: ctx.config.witness,
        zeroPodsTimeoutMs: ctx.probeReadOnly ? 10_000 : undefined });
      return 3;
    }
    const { probes, externalProbes } = buildProbes(ctx.config);
    // The api was frozen above, so a committed database always restarts the
    // api here before converging. Never boots a legacy image: ensureStarted
    // pins the candidate image.
    ctx.print?.('# recover: restarting committed api before finish-open');
    ensureStarted(ctx.call, 'api', ctx.config.images.candidate, { dryRun: ctx.dryRun, print: ctx.print });
    await finishOpen({ call: ctx.call, probe: ctx.probe, state, dryRun: ctx.dryRun, print: ctx.print,
      save: next => saveState(ctx.stateDir, next), images: ctx.config.images, probes, externalProbes });
    return 4;
  } finally {
    RECOVERY_IN_FLIGHT = false;
  }
}

// W3 rotation keys (Astra B3): wire applies the runtime overlay but never
// touches secret data, so the tenant key acts are explicit steps here —
// JWT_SECRET + SECRET_ENCRYPTION_KEY into sentropic-api, plus the dedicated
// auth-idp-session-signing secret. Values travel only via stdin (never argv,
// never logs: mutating calls print stdin as <redacted-stdin>). Merge patches
// only: kubectl apply would record every rotated value in the
// last-applied-configuration annotation.
export function applyRotationKeys(ctx) {
  const files = ctx.config.rotationKeyFiles ?? {};
  if (ctx.dryRun) {
    ctx.print('# dry-run: pose rotation keys from rotationKeyFiles (apiJwtSecretFile, secretEncryptionKeyFile, idpSessionJwtFile)');
    ctx.print('# dry-run: patch secret sentropic-api --type=merge (JWT_SECRET, SECRET_ENCRYPTION_KEY)');
    ctx.call(['patch', 'secret', 'sentropic-api', '--type=merge', '-p',
      JSON.stringify({ data: { JWT_SECRET: 'dry-run', SECRET_ENCRYPTION_KEY: 'dry-run' } })]);
    return;
  }
  let apiJwt = 'dry-run', encKey = 'dry-run', idpJwt = 'dry-run';
  if (files.apiJwtSecretFile && files.secretEncryptionKeyFile && files.idpSessionJwtFile) {
    apiJwt = readFileSync(files.apiJwtSecretFile, 'utf8').trim();
    encKey = readFileSync(files.secretEncryptionKeyFile, 'utf8').trim();
    idpJwt = readFileSync(files.idpSessionJwtFile, 'utf8').trim();
    if (!apiJwt || !encKey || !idpJwt) throw new Error('rotation_keys_empty');
  } else if (!ctx.dryRun) {
    throw new Error('rotation_keys_missing: apiJwtSecretFile,secretEncryptionKeyFile,idpSessionJwtFile');
  }
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  ctx.call(['patch', 'secret', 'sentropic-api', '--type=merge', '-p',
    JSON.stringify({ data: { JWT_SECRET: b64(apiJwt), SECRET_ENCRYPTION_KEY: b64(encKey) } })]);
  let idpExists = false;
  try {
    const cur = ctx.call(['get', 'secret', 'auth-idp-session-signing', '-o', 'json']);
    idpExists = Boolean(cur && JSON.parse(cur || '{}').metadata);
  } catch { idpExists = false; }
  if (idpExists) {
    ctx.call(['patch', 'secret', 'auth-idp-session-signing', '--type=merge', '-p',
      JSON.stringify({ data: { JWT_SECRET: b64(idpJwt) } })]);
  } else {
    ctx.call(['create', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'Secret',
      metadata: { name: 'auth-idp-session-signing', namespace: ctx.config.namespace }, type: 'Opaque',
      data: { JWT_SECRET: b64(idpJwt) } }));
  }
  if (!ctx.dryRun) {
    const after = JSON.parse(ctx.call(['get', 'secret', 'sentropic-api', '-o', 'json']) || '{"data":{}}');
    const left = ROTATED_KEYS.filter(key => after.data?.[key] === undefined);
    if (left.length > 0) throw new Error(`rotation_keys_not_applied: ${left.join(',')}`);
    const idp = JSON.parse(ctx.call(['get', 'secret', 'auth-idp-session-signing', '-o', 'json']) || '{"data":{}}');
    if (idp.data?.JWT_SECRET === undefined) throw new Error('rotation_keys_not_applied: auth-idp-session-signing');
  }
  ctx.print?.('# W3 rotation keys posed: JWT_SECRET, SECRET_ENCRYPTION_KEY, auth-idp-session-signing');
}

function baseEnv(ctx, extra = {}) {
  return { A4_TIER: ctx.tier, A4_KUBECONFIG_FILE: ctx.config.kubeconfigFile,
    A4_REQUEST_FILE: `${ctx.stateDir}/request.json`, A4_DRY_RUN: ctx.dryRun ? '1' : '0', ...extra };
}

// W0..W9 with hard per-step cutoffs measured from t0 (fence start). Any throw
// or cutoff breach routes to recover(); the watchdog covers driver death.
export async function drive(ctx) {
  const state = { version: 1, step: 'W0', startedAtUtc: utcNow(), driverPid: process.pid,
    childPid: process.pid, namespace: ctx.config.namespace, middlewareSpec: ctx.config.middlewareSpec ?? null,
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
  // Per-command timeout: never outlive the current step's hard cutoff nor
  // the total budget. A sub-command that cannot finish in time fails fast
  // and routes to recovery instead of overrunning the step.
  const to = (ms, step) => Math.max(1000, Math.min(
    stepTimeoutMs(ms, t0 + STEP_CUTOFFS[step]), left()));
  heartbeat(ctx, state, 'W1');
  ctx.d1 = (ctx.delivered ?? delivered)(ctx, 'execution.mjs', { ...baseEnv(ctx), A4_ACTION: 'fence',
    A4_AUTHORIZATION_FILE: ctx.config.authorizationFile,
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(30_000, 'W1'));
  if (monoMs() > cutoff(25_000)) return recover(ctx, state, 'W1_cutoff');
  heartbeat(ctx, state, 'W2');
  writeFileSync(`${ctx.stateDir}/request.json`, JSON.stringify(ctx.config.request), { mode: 0o600 });
  // B3: restrict only AFTER request.json exists (it asserts legacyWritersStopped).
  (ctx.delivered ?? delivered)(ctx, 'execution.mjs', { ...baseEnv(ctx), A4_ACTION: 'restrict',
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(60_000, 'W2'));
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
    if (missing && !ctx.probeReadOnly && !ctx.dryRun) throw new Error('middleware_missing_after_restrict');
    if (missing) ctx.print('# note: no a4-verification middleware (no fence here)');
  }
  state.storesSha256 = hashRows(psql(ctx, splitSql(loadSql('t3-classify.sql')).Q6));
  saveState(ctx.stateDir, state);
  if (monoMs() > cutoff(35_000)) return recover(ctx, state, 'W2_cutoff');
  heartbeat(ctx, state, 'W3');
  ctx.d3 = (ctx.delivered ?? delivered)(ctx, 'ops.mjs', { ...baseEnv(ctx), A4_OPERATION: 'wire',
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(60_000, 'W3'));
  applyRotationKeys(ctx);
  if (monoMs() > cutoff(50_000)) return recover(ctx, state, 'W3_cutoff');
  for (const [step, script, env] of [
    ['W4', 'ops.mjs', { A4_OPERATION: 'custodian' }],
    ['W5', 'run.mjs', { A4_PHASE: 'snapshot' }],
    ['W6', 'run.mjs', { A4_PHASE: 'checkpoint' }],
    ['W7a', 'execution.mjs', { A4_ACTION: 'delete-custodian' }],
  ]) {
    heartbeat(ctx, state, step);
    (ctx.delivered ?? delivered)(ctx, script, { ...baseEnv(ctx), ...env,
      A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(120_000, step));
    if (step === 'W5') {
      (ctx.delivered ?? delivered)(ctx, 'ops.mjs', { ...baseEnv(ctx), A4_OPERATION: 'budgets',
        A4_BUDGETS_FILE: ctx.config.budgetsFile,
        A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(60_000, 'W5'));
      const now = hashRows(psql(ctx, splitSql(loadSql('t3-classify.sql')).Q6));
      if (now !== state.storesSha256) throw new Error('encrypted_stores_drift');
    }
    if (monoMs() > cutoff(STEP_CUTOFFS[step])) return recover(ctx, state, `${step}_cutoff`);
  }
  heartbeat(ctx, state, 'W7b');
  if (monoMs() > cutoff(COMMIT_CUTOFF_MS)) return recover(ctx, state, 'W7_cutoff');
  (ctx.delivered ?? delivered)(ctx, 'execution.mjs', { ...baseEnv(ctx), A4_ACTION: 'start-api',
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(120_000, 'W7b'));
  let info;
  if (ctx.dryRun && !ctx.probeReadOnly) {
    // Pure dry-run executes nothing, not even reads: simulate the committed
    // branch so the printed plan covers the nominal W8 opening.
    ctx.print('# dry-run: simulated classify (committed, api ready)');
    info = { journal: true, locks: 0, committed: true, receipts: 1, apiReady: true, relations: [] };
  } else {
    info = classify(ctx);
  }
  state.commitVerified = info.committed;
  state.apiReady = info.apiReady;
  state.locks = info.locks;
  state.receipts = info.receipts;
  saveState(ctx.stateDir, state);
  // Never open traffic on an unverified commit or a dead api: recovery rolls
  // back pre-commit, or restarts the api and converges post-commit.
  if (!info.committed) return recover(ctx, state, 'commit_unverified');
  if (!info.apiReady) return recover(ctx, state, 'api_not_ready');
  heartbeat(ctx, state, 'W8');
  if (monoMs() > cutoff(FINISH_CUTOFF_MS)) return recover(ctx, state, 'W8_cutoff');
  const { probes, externalProbes } = buildProbes(ctx.config);
  await finishOpen({ call: ctx.call, probe: ctx.probe, state, dryRun: ctx.dryRun, print: ctx.print,
    save: next => saveState(ctx.stateDir, next), images: ctx.config.images, probes, externalProbes });
  heartbeat(ctx, state, 'W9');
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
  const timeoutRef = {};
  const call = runKubectl({ kubeconfig: config.kubeconfigFile, namespace: config.namespace,
    dryRun, probeReadOnly, execIsReadOnly: probeReadOnly, timeoutRef, print: console.log, stateDir });
  const ctx = { call, timeoutRef, config, stateDir, dryRun, probeReadOnly, tier: config.tier,
    postgresPod: config.postgresPod ?? 'postgres-0', probe: fetch, print: console.log };
  const watchdog = spawn('node', [join(HERE, 't3-watchdog.mjs'),
    '--state-dir', stateDir, '--config', configPath,
    ...(dryRun ? ['--dry-run'] : []), ...(probeReadOnly ? ['--probe-readonly'] : [])],
    { detached: true, stdio: 'ignore' });
  watchdog.unref();
  try {
    process.exitCode = await drive(ctx);
  } catch (err) {
    console.error(`driver_fatal: ${err.message}`);
    process.exitCode = 1;
  }
}
