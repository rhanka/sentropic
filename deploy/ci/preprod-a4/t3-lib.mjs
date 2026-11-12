import { supervisedSync } from './t3-processes.mjs';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';

// Monotonic milliseconds shared by driver and watchdog. CLOCK_BOOTTIME via
// /proc/uptime is immune to NTP steps; Date.now is log-only, never budget.
export function monoMs() {
  try {
    const first = readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0];
    const seconds = Number(first);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  } catch { /* fall through to wall clock (tests, non-Linux) */ }
  return Date.now();
}

// Real pod selectors from deploy/k8s/base/30-api.yaml (B1: never `app=api`,
// which matches nothing and would fake a zero-pod proof).
export const podLabels = {
  api: 'app.kubernetes.io/name=sentropic,app.kubernetes.io/component=api',
  'auth-idp': 'app.kubernetes.io/name=sentropic,app.kubernetes.io/component=auth-idp',
  ui: 'app.kubernetes.io/name=sentropic,app.kubernetes.io/component=ui',
};

const READ_ONLY = new Set(['get', 'auth', 'describe', 'logs', 'top', 'version', 'api-resources', 'kustomize', 'diff']);

export function isReadOnly(args, execIsReadOnly = false) {
  return READ_ONLY.has(args[0]) || (execIsReadOnly && args[0] === 'exec');
}

// kubectl runner with a hard timeout (Fable B1: the pilot kills its
// subprocesses on a timer). Dry-run prints mutating commands and runs only
// reads when probeReadOnly is set; plain dry-run executes nothing. In probe
// contexts exec counts as read-only: the driver only ever execs the
// SELECT-only t3-classify.sql through it (statically asserted in tests).
// kubectl exec only forwards stdin to the container with -i; without it
// psql silently reads EOF and returns empty output with status 0.
export function withExecStdin(args, input) {
  return input !== undefined && args[0] === 'exec' ? ['exec', '-i', ...args.slice(1)] : args;
}

export function effectiveTimeout(timeoutMs, timeoutRef, nowMs = monoMs()) {
  const cap = timeoutRef?.deadlineMs != null
    ? timeoutRef.deadlineMs - nowMs
    : Infinity;
  if (cap <= 0) throw new Error('budget_exhausted');
  return Math.min(timeoutMs, cap);
}

// One emergency budget, inherited across every CLI process. Expired windows
// fail closed before any write; restarting an entry point cannot extend it.
export function recoveryDeadline(stateDir = process.env.T3_STATE_DIR) {
  const now = monoMs();
  const state = stateDir ? loadState(stateDir) : null;
  const inherited = process.env.T3_DEADLINE_MONO_MS == null ? Infinity : Number(process.env.T3_DEADLINE_MONO_MS);
  if (Number.isNaN(inherited)) throw new Error('invalid_recovery_deadline');
  const deadlineMs = Math.min(now + 125_000, inherited,
    state?.t0MonoMs == null ? Infinity : state.t0MonoMs + 300_000);
  effectiveTimeout(1, { deadlineMs }, now);
  return deadlineMs;
}

export function runKubectl({ kubeconfig, namespace, timeoutMs = 60_000, dryRun = false, probeReadOnly = false, execIsReadOnly = false, timeoutRef = null, print = () => {}, stateDir = null }) {
  const track = (childPid) => {
    if (!stateDir) return;
    try {
      const cur = loadState(stateDir);
      if (!cur) return;
      cur.childPid = childPid;
      cur.heartbeatMonoMs = cur.heartbeatMonoMs ?? monoMs();
      saveState(stateDir, cur);
    } catch { /* best-effort observability only */ }
  };
  return (args, input, overrideMs) => {
    const effective = withExecStdin(args, input);
    const line = `kubectl --namespace ${namespace} ${effective.join(' ')}`;
    if (dryRun && (!probeReadOnly || !isReadOnly(args, execIsReadOnly))) {
      print(dryRunLine(line, input !== undefined));
      return '';
    }
    track(process.pid);
    const started = monoMs();
    const result = supervisedSync('kubectl',
      ['--kubeconfig', kubeconfig, '--namespace', namespace, '--request-timeout=60s', ...effective],
      { input, encoding: 'utf8', timeout: effectiveTimeout(overrideMs ?? timeoutMs, timeoutRef), maxBuffer: 32 * 1024 * 1024 }, stateDir);
    track(result?.pid ?? null);
    if (probeReadOnly) print(`# ${(monoMs() - started)}ms ${line}`);
    if (result.error || result.status !== 0) {
      const err = new Error(`kubectl_failed: ${effective.slice(0, 3).join(' ')}`);
      err.cause = result.error?.message ?? result.stderr?.slice(0, 300);
      throw err;
    }
    return result.stdout;
  };
}

// Exact W8d probe URLs are operator inputs (qualified in P-0.4): the driver
// never invents OAuth scopes or redirect URIs. Shared by the window driver
// and the standalone finish-open CLI so both build the same probes from
// config.endpoints.
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

export function validateProbes(probes) {
  const required = { 'S-3': 200, 'S-4': 200, 'S-5': 200, 'S-6': 302,
    'S-7': 401, 'S-8': 401, 'S-9a': 200, 'S-9b': 200 };
  for (const [id, status] of Object.entries(required)) {
    const p = probes.find(p => p.id === id);
    if (!p || p.expect !== status || !URL.canParse(p.url) || !['http:', 'https:'].includes(new URL(p.url).protocol)) {
      throw new Error(`mandatory_probes_missing: ${id}`);
    }
  }
}

function dryRunLine(line, hasInput) {
  return hasInput ? `${line} <redacted-stdin>` : line;
}

export function loadState(dir) {
  try {
    return JSON.parse(readFileSync(`${dir}/t3-window-state.json`, 'utf8'));
  } catch {
    return null;
  }
}

// Atomic 0600 write: tmp file + rename, never a partial state for the watchdog.
export function saveState(dir, state) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${dir}/t3-window-state.json.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, `${dir}/t3-window-state.json`);
}

export function utcNow() {
  return new Date().toISOString();
}

// Single-writer claim for recovery: exactly one of driver/watchdog recovers.
// The lock file holds `owner|monoMs`. Only a dead owner permits takeover.
// Live recovery commands are bounded by the original fence deadline.
export function readRecoveryClaim(dir) {
  try {
    const [owner, at] = readFileSync(`${dir}/t3-recovering.lock`, 'utf8').split('|');
    return { owner, at: Number(at) };
  } catch {
    return null;
  }
}

export function claimRecovery(dir, owner) {
  const path = `${dir}/t3-recovering.lock`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(path, 'wx', 0o600);
    writeSync(fd, `${owner}|${monoMs()}`);
    closeSync(fd);
    return true;
  } catch {
    // Single-flight: an existing claim is never re-granted, even to the
    // same owner. A concurrent recover() in the same process must stand
    // down instead of running a second recovery in parallel.
    return false;
  }
}

export function releaseRecovery(dir) {
  try { unlinkSync(`${dir}/t3-recovering.lock`); } catch { /* absent */ }
}

export function claimDead(claim) {
  if (!claim) return true;
  // Elapsed time alone is never proof that the current writer stopped.
  const m = String(claim.owner ?? '').match(/pid-(\d+)$/);
  if (m) {
    try { process.kill(Number(m[1]), 0); return false; }
    catch { return true; }
  }
  return false;
}

// Per-command timeout bounded by the current step's hard cutoff: a kubectl
// or delivered sub-command must never outlive the step that owns it.
export function stepTimeoutMs(requestedMs, deadlineMonoMs, nowMs = monoMs()) {
  return effectiveTimeout(requestedMs, { deadlineMs: deadlineMonoMs }, nowMs);
}
