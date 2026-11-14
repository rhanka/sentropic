import { spawn } from 'node:child_process';
import { supervisedSync } from './t3-processes.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildProbes, claimDead, claimRecovery, effectiveTimeout, monoMs, readRecoveryClaim, releaseRecovery,
  runKubectl, loadState, saveState, stepTimeoutMs, utcNow, validateProbes } from './t3-lib.mjs';
import { ROTATED_KEYS, preCommitRollback, waitZeroPods } from './t3-rollback.mjs';
import { ensureStarted, finishOpen } from './t3-finish-open.mjs';
import { checkApplicability } from './t3-applicability.mjs';
import { preflight } from './t3-preflight-static.mjs';
import { prepareFencedReceipt } from './t3-rehearsal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOTAL_BUDGET_MS = 300_000;
export const COMMIT_CUTOFF_MS = 175_000;
export const FINISH_CUTOFF_MS = 175_000;
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
  if (script === 'execution.mjs' && env.A4_ACTION === 'fence') {
    script = 't3-fence.mjs';
    env = { ...env, T3_STATE_DIR: ctx.stateDir };
  }
  const flat = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
  if (ctx.dryRun) { ctx.print(`# dry-run: ${flat} node ${script}`); return ''; }
  try {
    if (ctx.stateDir) {
      const cur = loadState(ctx.stateDir);
      if (cur) { cur.childPid = process.pid; saveState(ctx.stateDir, cur); }
    }
  } catch { /* observability only */ }
  const res = supervisedSync('node', [join(HERE, script)],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: timeoutMs }, ctx.stateDir);
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

// Hard per-step cutoffs from fence start. All nominal work stops by 175 s,
// leaving the rest of the original 300 s budget for recovery.
export const STEP_CUTOFFS = { W1: 25_000, W2: 35_000, W3: 50_000, W4: 70_000,
  W5: 110_000, W6: 125_000, W7a: 135_000, W7b: 175_000, W8: FINISH_CUTOFF_MS, W9: FINISH_CUTOFF_MS };

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
  // The armed CLI has exactly one recovery executor: its independent watchdog.
  // Never spend a short driver lease before repeating the whole recovery there.
  if (!ctx.recoverOwner && state.watchdogArmed && state.watchdogPid) {
    state.recoveryRequested = reason;
    saveState(ctx.stateDir,state);
    ctx.print?.('# recovery handed to armed watchdog');
    return 5;
  }
  // An explicit false marker means the new driver's fence never began.
  // The child persists it immediately before the first authorized write;
  // reread after stopping automation so an in-flight fence cannot be missed.
  if (state.fenceStarted === false) {
    state.fenceStarted = loadState(ctx.stateDir)?.fenceStarted === true;
    if (!state.fenceStarted) {
      state.step = 'DONE';
      state.watchdogDone = true;
      state.refusalReason = reason;
      saveState(ctx.stateDir, state);
      return 1;
    }
  }
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
    const now = ctx.now ?? monoMs;
    // Nominal work stops at 175 s, reserving recovery within the SAME fence.
    // A failed operation never extends the original 300 s deadline.
    const globalDeadline = state.t0MonoMs == null ? now() + 125_000 : state.t0MonoMs + TOTAL_BUDGET_MS;
    // Driver recovery has its own lease inside the fence, leaving 65 s for
    // the independent watchdog if the recovery owner itself stalls.
    const deadlineMs = Math.min(now() + (ctx.recoveryBudgetMs ?? (ctx.recoverOwner ? 125_000 : 60_000)),
      globalDeadline - (ctx.recoverOwner ? 0 : 65_000));
    if (deadlineMs <= now()) throw new Error('budget_exhausted');
    const originalCall = ctx.call;
    ctx = { ...ctx, call: (args, input, cap) => originalCall(args, input,
      effectiveTimeout(cap ?? 60_000, { deadlineMs }, now())) };
    state.stepDeadlineMonoMs = deadlineMs;
    if (ctx.timeoutRef) {
      ctx.timeoutRef.deadlineMs = deadlineMs;
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
    waitZeroPods(ctx.call, Math.min(deadlineMs, monoMs() + 40_000), ['api']);
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
      while (info.locks > 0 && monoMs() - waitStart < waitBudget && monoMs() + 2000 < deadlineMs) {
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
        deadlineMs,
        now,
        zeroPodsTimeoutMs: ctx.probeReadOnly ? 10_000 : undefined });
      // The driver recovered itself: mark DONE so the detached watchdog
      // stands down instead of running a second recovery on the reopened
      // cluster (Argon v3 BLOCKER 1).
      state.step = 'DONE';
      state.watchdogDone = true;
      saveState(ctx.stateDir, state);
      return 3;
    }
    const { probes, externalProbes, restrictedProbes } = buildProbes(ctx.config);
    // The api was frozen above, so a committed database always restarts the
    // api here before converging. Never boots a legacy image: ensureStarted
    // pins the candidate image.
    ctx.print?.('# recover: restarting committed api before finish-open');
    ensureStarted(ctx.call, 'api', ctx.config.images.candidate, { dryRun: ctx.dryRun, print: ctx.print });
    await finishOpen({ call: ctx.call, probe: ctx.probe, state, dryRun: ctx.dryRun, print: ctx.print,
      save: next => saveState(ctx.stateDir, next), images: ctx.config.images, probes, externalProbes, restrictedProbes, deadlineMs, now });
    // Same single-writer guard on the post-commit branch.
    state.step = 'DONE';
    state.watchdogDone = true;
    saveState(ctx.stateDir, state);
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
function writePatchFile(ctx, name, text) {
  mkdirSync(ctx.stateDir, { recursive: true, mode: 0o700 });
  const path = `${ctx.stateDir}/.t3-${name}-${process.pid}.json`;
  writeFileSync(path, text, { mode: 0o600 });
  return path;
}

export function applyRotationKeys(ctx) {
  const files = ctx.config.rotationKeyFiles ?? {};
  if (ctx.dryRun) {
    ctx.print('# dry-run: pose rotation keys from rotationKeyFiles (apiJwtSecretFile, secretEncryptionKeyFile, idpSessionJwtFile)');
    ctx.print('# dry-run: patch secret sentropic-api --type=merge via --patch-file (redacted)');
    ctx.call(['patch', 'secret', 'sentropic-api', '--type=merge', '--patch-file=<redacted>']);
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
  // Secrets travel only via --patch-file (0600, unlinked in finally) or via
  // stdin (create -f -): never in argv, never in logs. kubectl patch does
  // not create a last-applied-configuration annotation.
  const apiPatch = JSON.stringify({ data: { JWT_SECRET: b64(apiJwt), SECRET_ENCRYPTION_KEY: b64(encKey) } });
  const apiPatchFile = writePatchFile(ctx, 'api-patch', apiPatch);
  try {
    ctx.call(['patch', 'secret', 'sentropic-api', '--type=merge', `--patch-file=${apiPatchFile}`]);
  } finally {
    try { unlinkSync(apiPatchFile); } catch { /* best-effort */ }
  }
  let idpExists = false;
  try {
    const cur = ctx.call(['get', 'secret', 'auth-idp-session-signing', '-o', 'json']);
    idpExists = Boolean(cur && JSON.parse(cur || '{}').metadata);
  } catch { idpExists = false; }
  if (idpExists) {
    const idpPatch = JSON.stringify({ data: { JWT_SECRET: b64(idpJwt) } });
    const idpPatchFile = writePatchFile(ctx, 'idp-patch', idpPatch);
    try {
      ctx.call(['patch', 'secret', 'auth-idp-session-signing', '--type=merge', `--patch-file=${idpPatchFile}`]);
    } finally {
      try { unlinkSync(idpPatchFile); } catch { /* best-effort */ }
    }
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
  const state = ctx.initialState ?? initializeState(ctx);
  try {
    return await driveInner(ctx, state);
  } catch (err) {
    return recover(ctx, state, `throw:${err.message}`);
  }
}

function initializeState(ctx) {
  assertPreviewSafe(ctx);
  validateProbes(buildProbes(ctx.config).probes);
  const state = { version: 1, step: 'W0', fenceStarted: false, startedAtUtc: utcNow(), driverPid: process.pid,
    watchdogPid: ctx.watchdogPid,
    childPid: process.pid, namespace: ctx.config.namespace, operationId: ctx.config.request?.operationId,
    middlewareSpec: ctx.config.middlewareSpec ?? null,
    stepDeadlineMonoMs: monoMs() + 600_000 };
  saveState(ctx.stateDir, state);
  return state;
}

function assertPreviewSafe(ctx) {
  const previous = loadState(ctx.stateDir);
  if (ctx.dryRun && ((previous && previous.step !== 'DONE') || readRecoveryClaim(ctx.stateDir))) {
    throw new Error('preview_active_state: use a separate state directory');
  }
}

async function driveInner(ctx, state) {
  checkRbac(ctx);
  checkApplicability(ctx, psql, 'W0');
  const t0 = monoMs();
  state.t0MonoMs = t0;
  const cutoff = ms => t0 + ms;
  const left = () => cutoff(TOTAL_BUDGET_MS) - monoMs();
  // Per-command timeout: never outlive the current step's hard cutoff nor
  // the total budget. A sub-command that cannot finish in time fails fast
  // and routes to recovery instead of overrunning the step.
  const to = (ms, step) => Math.min(stepTimeoutMs(ms, t0 + STEP_CUTOFFS[step]), left());
  heartbeat(ctx, state, 'W1');
  // Injected executors own their mutation boundary; real execution records
  // it inside t3-fence after authorization validation, before kubectl.
  if (ctx.delivered) { state.fenceStarted = true; saveState(ctx.stateDir, state); }
  ctx.d1 = (ctx.delivered ?? delivered)(ctx, 'execution.mjs', { ...baseEnv(ctx), A4_ACTION: 'fence',
    A4_AUTHORIZATION_FILE: ctx.config.authorizationFile,
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(30_000, 'W1'));
  state.fenceStarted = loadState(ctx.stateDir)?.fenceStarted === true;
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
  checkApplicability(ctx, psql, 'W2');
  saveState(ctx.stateDir, state);
  if (monoMs() > cutoff(35_000)) return recover(ctx, state, 'W2_cutoff');
  heartbeat(ctx, state, 'W3');
  ctx.d3 = (ctx.delivered ?? delivered)(ctx, 'ops.mjs', { ...baseEnv(ctx), A4_OPERATION: 'wire',
    A4_EXECUTION_FILE: ctx.config.executionFile, A4_EXECUTION_SHA256: ctx.config.executionSha256 }, to(60_000, 'W3'));
  applyRotationKeys(ctx);
  (ctx.delivered ?? delivered)(ctx, 'ops.mjs', { ...baseEnv(ctx), A4_OPERATION: 'budgets',
    A4_BUDGETS_FILE: ctx.config.budgetsFile }, to(60_000, 'W3'));
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
    let rehearsalFile = ctx.config.rehearsalFile;
    if (step === 'W5') {
      checkApplicability(ctx, psql, 'W5');
      rehearsalFile = prepareFencedReceipt(ctx,psql);
    }
    if (step === 'W4' || step === 'W5') {
      (ctx.delivered ?? delivered)(ctx, 'ops.mjs', { ...baseEnv(ctx), A4_OPERATION: 'stage',
        A4_STAGE: step === 'W4' ? 'inputs' : 'rehearsal',
        A4_REMOTE_FILE: ctx.config.remoteFile, A4_REHEARSAL_FILE: rehearsalFile }, to(30_000, step));
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
  const { probes, externalProbes, restrictedProbes } = buildProbes(ctx.config);
  await finishOpen({ call: ctx.call, probe: ctx.probe, state, dryRun: ctx.dryRun, print: ctx.print,
    save: next => saveState(ctx.stateDir, next), images: ctx.config.images, probes, externalProbes,restrictedProbes,
    deadlineMs: t0 + FINISH_CUTOFF_MS });
  heartbeat(ctx, state, 'W9');
  if (monoMs() > cutoff(TOTAL_BUDGET_MS)) return recover(ctx, state, 'total_budget');
  state.step = 'DONE';
  state.watchdogDone = true;
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
  try {
    if (!dryRun) preflight(config);
    ctx.initialState = initializeState(ctx);
    const watchdog = spawn(process.execPath, [join(HERE, 't3-watchdog.mjs'),
      '--state-dir', stateDir, '--config', configPath,
      ...(dryRun ? ['--dry-run'] : []), ...(probeReadOnly ? ['--probe-readonly'] : [])],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('watchdog_arm_timeout')), 2000);
        const finish = fn => value => { clearTimeout(timer); fn(value); };
        watchdog.once('error', finish(reject));
        watchdog.once('exit', finish(() => reject(new Error('watchdog_start_failed'))));
        watchdog.once('message', finish(message => message?.armed === watchdog.pid
          ? resolve() : reject(new Error('watchdog_not_armed'))));
      });
      process.kill(watchdog.pid, 0);
      ctx.initialState.watchdogPid = watchdog.pid;
      ctx.initialState.watchdogArmed = true;
      saveState(stateDir, ctx.initialState);
    } catch (err) {
      watchdog.kill('SIGKILL');
      throw err;
    } finally {
      if (watchdog.connected) watchdog.disconnect();
      watchdog.unref();
    }
    process.exitCode = await drive(ctx);
  } catch (err) {
    console.error(`driver_fatal: ${err.message}`);
    process.exitCode = 1;
  }
}
