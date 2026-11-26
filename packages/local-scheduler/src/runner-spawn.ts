import { spawn, type ChildProcess } from 'node:child_process';
import { RUNS_LOG_EXCERPT_BYTES } from './log-rotator.js';
import type { LocalTaskOutcomeV1 } from './witness.js';

export interface ChildRunOutcome {
  readonly outcome: Extract<LocalTaskOutcomeV1, 'succeeded' | 'failed' | 'timed_out' | 'interrupted'>;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly runnerExitCode: 0 | 1 | 124 | 130 | 143;
  readonly durationMs: number;
  readonly excerpt: string;
}

export function spawnDetachedChild(
  bin: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(bin, [...args], {
    shell: false,
    detached: true,
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isProcessGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function waitForProcessGroupExit(pgid: number, stopStartedRealMs: number, killGraceMs: number): Promise<void> {
  return new Promise((resolve) => {
    let sigkillSent = false;
    let sigkillAtMs = 0;
    const check = (): void => {
      if (!isProcessGroupAlive(pgid)) {
        resolve();
        return;
      }
      const now = performance.now();
      if (!sigkillSent && now - stopStartedRealMs >= killGraceMs) {
        sigkillSent = true;
        sigkillAtMs = now;
        try { process.kill(-pgid, 'SIGKILL'); } catch { /* group already exited */ }
        if (!isProcessGroupAlive(pgid)) {
          resolve();
          return;
        }
      }
      if (sigkillSent && now - sigkillAtMs >= 500) {
        resolve();
        return;
      }
      setTimeout(check, sigkillSent ? 10 : 20);
    };
    check();
  });
}

/** Supervises a detached child process group with hard timeout and SIGTERM/SIGINT forwarding. */
export function awaitDetachedChild(
  child: ChildProcess,
  timeoutMs: number,
  killGraceMs: number,
  perfNow: () => number = () => performance.now(),
): Promise<ChildRunOutcome> {
  return new Promise((resolve) => {
    const startMono = perfNow();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const capBytes = RUNS_LOG_EXCERPT_BYTES;
    const pushChunk = (data: Buffer): void => {
      if (totalBytes >= capBytes) return;
      const slice = data.subarray(0, capBytes - totalBytes);
      chunks.push(slice);
      totalBytes += slice.length;
    };
    child.stdout?.on('data', pushChunk);
    child.stderr?.on('data', pushChunk);

    let timedOut = false;
    let interruptedSignal: 'SIGINT' | 'SIGTERM' | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let terminating = false;
    let stopStartedRealMs = 0;

    const triggerStop = (): void => {
      if (terminating || child.pid === undefined) return;
      terminating = true;
      stopStartedRealMs = performance.now();
      const pgid = child.pid;
      try { process.kill(-pgid, 'SIGTERM'); } catch { /* group already exited */ }
      graceTimer = setTimeout(() => {
        try { process.kill(-pgid, 'SIGKILL'); } catch { /* group already exited */ }
      }, killGraceMs);
    };
    const timeoutTimer = setTimeout(() => {
      if (!interruptedSignal) { timedOut = true; triggerStop(); }
    }, timeoutMs);

    const onSigInt = (): void => { if (!interruptedSignal) { interruptedSignal = 'SIGINT'; triggerStop(); } };
    const onSigTerm = (): void => { if (!interruptedSignal) { interruptedSignal = 'SIGTERM'; triggerStop(); } };
    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);

    let settled = false;
    const settle = async (code: number | null, signal: NodeJS.Signals | null, spawnErr?: string): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (terminating && child.pid !== undefined) {
        await waitForProcessGroupExit(child.pid, stopStartedRealMs, killGraceMs);
      }
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
      const durationMs = Math.max(0, Math.round(perfNow() - startMono));
      const excerpt = spawnErr ? `${Buffer.concat(chunks).toString('utf8')}\n${spawnErr}`.trim() : Buffer.concat(chunks).toString('utf8');

      if (interruptedSignal === 'SIGINT') {
        resolve({ outcome: 'interrupted', exitCode: null, signal: 'SIGINT', runnerExitCode: 130, durationMs, excerpt });
      } else if (interruptedSignal === 'SIGTERM') {
        resolve({ outcome: 'interrupted', exitCode: null, signal: 'SIGTERM', runnerExitCode: 143, durationMs, excerpt });
      } else if (timedOut) {
        resolve({ outcome: 'timed_out', exitCode: null, signal: signal ?? 'SIGTERM', runnerExitCode: 124, durationMs, excerpt });
      } else if (code === 0 && !spawnErr) {
        resolve({ outcome: 'succeeded', exitCode: 0, signal: null, runnerExitCode: 0, durationMs, excerpt });
      } else {
        resolve({ outcome: 'failed', exitCode: code, signal, runnerExitCode: 1, durationMs, excerpt });
      }
    };

    child.on('error', (err) => { void settle(null, null, err.message); });
    child.on('close', (code, signal) => { void settle(code, signal); });
  });
}
