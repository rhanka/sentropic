import { stopAutomation } from './t3-processes.mjs';
import { readFileSync } from 'node:fs';
import { claimDead, claimRecovery, monoMs, readRecoveryClaim, releaseRecovery,
  runKubectl, loadState, saveState } from './t3-lib.mjs';
import { classify, recover } from './t3-window-driver.mjs';

// The driver cannot watch itself: a dead driver leaves prod fenced. This
// process is spawned detached by the driver CLI and owns exactly one duty —
// when the driver dies, stalls past its heartbeat, or breaches the total
// budget, kill any remainder and run the pre-commit rollback (or the
// post-commit convergence) itself, then record the outcome.
const TOTAL_BUDGET_MS = 175_000;
const STALE_MS = 1000;
const POLL_MS = 250;

function cliArg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

function pidDead(pid) {
  if (!pid) return true;
  try { process.kill(pid, 0); return false; } catch { return true; }
}

// Single-flight across overlapping 250 ms ticks: poll() is async and
// recover() yields at the first await, so a second tick would otherwise
// start a second concurrent recover() for the same stale driver.
let pollInFlight = false;

// One poll: 'waiting' | 'done' | exit code after firing the recovery.
export async function poll(ctx) {
  if (pollInFlight) return 'recovery-in-progress';
  pollInFlight = true;
  try {
    return await pollInner(ctx);
  } finally {
    pollInFlight = false;
  }
}

async function pollInner(ctx) {
  const me = `watchdog-pid-${process.pid}`;
  const state = loadState(ctx.stateDir);
  if (!state) return 'waiting';
  if (state.step === 'DONE' || state.watchdogDone) return 'done';
  const now = monoMs();
  const stale = now - (state.heartbeatMonoMs ?? 0) > STALE_MS;
  const over = state.t0MonoMs != null && now - state.t0MonoMs > TOTAL_BUDGET_MS;
  const past = state.stepDeadlineMonoMs != null && now > state.stepDeadlineMonoMs;
  const alive = !pidDead(state.driverPid);
  if (alive && !state.recoveryRequested && !over && !(stale && past)) return 'waiting';
  const reason = state.recoveryRequested ?? (!alive ? 'watchdog_driver_dead' : over ? 'watchdog_budget' : 'watchdog_stale_past_deadline');
  if (!claimRecovery(ctx.stateDir, me)) {
    const owner = readRecoveryClaim(ctx.stateDir);
    if (!claimDead(owner)) {
      // Never steal from a running writer. An expired driver recovery is
      // first stopped, including its command groups, with extinction proof.
      if (!past || owner.owner !== `pid-${state.driverPid}`) return 'recovery-in-progress';
      stopAutomation(ctx.stateDir, state);
      if (readRecoveryClaim(ctx.stateDir)?.owner !== owner.owner) return 'recovery-in-progress';
    }
    releaseRecovery(ctx.stateDir);
    if (!claimRecovery(ctx.stateDir, me)) return 'recovery-in-progress';
  }
  stopAutomation(ctx.stateDir, state);
  console.log(`watchdog_firing reason=${reason} step=${state.step}`);
  const code = await recover({ ...ctx, recoverOwner: me }, state, reason);
  state.watchdogDone = true;
  state.watchdogExit = code;
  saveState(ctx.stateDir, state);
  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const stateDir = cliArg(argv, '--state-dir');
  const config = JSON.parse(readFileSync(cliArg(argv, '--config') ?? cliArg(argv, '--config-file'), 'utf8'));
  const dryRun = argv.includes('--dry-run');
  const probeReadOnly = argv.includes('--probe-readonly');
  const timeoutRef = {};
  const call = runKubectl({ kubeconfig: config.kubeconfigFile, namespace: config.namespace,
    dryRun, probeReadOnly, execIsReadOnly: probeReadOnly, timeoutRef, print: console.log, stateDir });
  const ctx = { call, timeoutRef, config, stateDir, dryRun, probeReadOnly,
    tier: config.tier, postgresPod: config.postgresPod ?? 'postgres-0',
    probe: fetch, print: console.log };
  if (process.send) {
    const initial = loadState(stateDir);
    if (!initial || pidDead(initial.driverPid)) throw new Error('watchdog_state_not_initialized');
    process.send({ armed: process.pid });
  }
  const timer = setInterval(async () => {
    try {
      const out = await poll(ctx);
      if (out !== 'waiting' && out !== 'recovery-in-progress') {
        clearInterval(timer);
        process.exitCode = out === 'done' ? 0 : Number(out) || 1;
      }
    } catch (err) {
      clearInterval(timer);
      console.error(`watchdog_failed: ${err.message}`);
      process.exitCode = 1;
    }
  }, POLL_MS);
}
