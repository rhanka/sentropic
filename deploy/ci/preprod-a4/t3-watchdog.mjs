import { readFileSync } from 'node:fs';
import { monoMs, runKubectl, loadState, saveState } from './t3-lib.mjs';
import { classify, recover } from './t3-window-driver.mjs';

// The driver cannot watch itself: a dead driver leaves prod fenced. This
// process is spawned detached by the driver CLI and owns exactly one duty —
// when the driver dies, stalls past its heartbeat, or breaches the total
// budget, kill any remainder and run the pre-commit rollback (or the
// post-commit convergence) itself, then record the outcome.
const TOTAL_BUDGET_MS = 300_000;
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

function killPid(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

// One poll: 'waiting' | 'done' | exit code after firing the recovery.
export async function poll(ctx) {
  const state = loadState(ctx.stateDir);
  if (!state || state.step === 'DONE' || state.watchdogDone) return 'done';
  const now = monoMs();
  const stale = now - (state.heartbeatMonoMs ?? 0) > STALE_MS;
  const over = state.t0MonoMs != null && now - state.t0MonoMs > TOTAL_BUDGET_MS;
  const past = state.stepDeadlineMonoMs != null && now > state.stepDeadlineMonoMs;
  const alive = !pidDead(state.driverPid);
  if (alive && !over && !(stale && past)) return 'waiting';
  const reason = !alive ? 'watchdog_driver_dead' : over ? 'watchdog_budget' : 'watchdog_stale_past_deadline';
  for (const pid of [state.driverPid, state.childPid]) if (pid && !pidDead(pid)) killPid(pid);
  console.log(`watchdog_firing reason=${reason} step=${state.step}`);
  const code = await recover(ctx, state, reason);
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
  const call = runKubectl({ kubeconfig: config.kubeconfigFile, namespace: config.namespace,
    dryRun, print: console.log });
  const ctx = { call, config, stateDir, dryRun, probeReadOnly: false,
    tier: config.tier, postgresPod: config.postgresPod ?? 'postgres-0',
    probe: fetch, print: console.log };
  const stopAt = monoMs() + TOTAL_BUDGET_MS + 180_000;
  const timer = setInterval(async () => {
    try {
      const out = await poll(ctx);
      if (out !== 'waiting' || monoMs() > stopAt) {
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
