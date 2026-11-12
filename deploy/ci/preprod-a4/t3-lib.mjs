import { spawnSync } from 'node:child_process';
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

export function runKubectl({ kubeconfig, namespace, timeoutMs = 60_000, dryRun = false, probeReadOnly = false, execIsReadOnly = false, print = () => {} }) {
  return (args, input) => {
    const effective = withExecStdin(args, input);
    const line = `kubectl --namespace ${namespace} ${effective.join(' ')}`;
    if (dryRun && (!probeReadOnly || !isReadOnly(args, execIsReadOnly))) {
      print(dryRunLine(line, input !== undefined));
      return '';
    }
    const started = monoMs();
    const result = spawnSync('kubectl',
      ['--kubeconfig', kubeconfig, '--namespace', namespace, '--request-timeout=60s', ...effective],
      { input, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    if (probeReadOnly) print(`# ${(monoMs() - started)}ms ${line}`);
    if (result.error || result.status !== 0) {
      const err = new Error(`kubectl_failed: ${effective.slice(0, 3).join(' ')}`);
      err.cause = result.error?.message ?? result.stderr?.slice(0, 300);
      throw err;
    }
    return result.stdout;
  };
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
// The lock file holds `owner|monoMs`. A claim owned by a dead pid or older
// than two minutes is take-over-able; anything else forces stand-down.
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
  // A claim older than two minutes is take-over-able even when its process
  // still answers kill(0): a driver wedged inside recover() must not hold
  // the watchdog in 'recovery-in-progress' forever.
  if (monoMs() - (claim.at || 0) > 120_000) return true;
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
  return Math.max(1000, Math.min(requestedMs, deadlineMonoMs - nowMs));
}
