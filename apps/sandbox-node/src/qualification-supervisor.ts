import { spawn, type ChildProcess } from 'node:child_process';
import { qualificationDeadline } from './qualification-deadline.js';

export function terminateQualification(child: ChildProcess, signal: NodeJS.Signals): void {
  // The flock helper must survive until the worker has finished its graceful cleanup.
  if (signal === 'SIGTERM') { child.kill(signal); return; }
  if (child.pid) {
    try { process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
}

/** A separate event loop enforces wall-clock limits even during synchronous host commands. */
export function superviseQualification(timeoutMs = qualificationDeadline(),
  launch: () => ChildProcess = () => spawn(process.execPath, ['--qualify-data-plane-worker'], { stdio: 'inherit', detached: true }),
  terminate: (child: ChildProcess, signal: NodeJS.Signals) => void = terminateQualification): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = launch();
    let stopped = false, finished = false, killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (stopped || finished) return;
      stopped = true;
      killTimer = setTimeout(() => terminate(child, 'SIGKILL'), 10_000);
      terminate(child, 'SIGTERM');
    };
    const timer = setTimeout(stop, timeoutMs);
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    const finish = (error?: Error) => {
      if (finished) return; finished = true;
      clearTimeout(timer); clearTimeout(killTimer);
      process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
      if (error) reject(error); else resolve();
    };
    child.once('error', error => finish(error));
    child.once('exit', code => finish(code === 0 && !stopped ? undefined : new Error('qualification worker failed')));
  });
}
