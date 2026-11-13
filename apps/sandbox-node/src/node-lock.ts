import { spawn } from 'node:child_process';

/** Kernel flock, held by a pipe child for the entire agent/qualification lifetime. */
export function acquireNodeLock(path = '/run/lock/execution-node.lock'): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const child = spawn('flock', ['--nonblock', path, 'sh', '-c', 'echo locked; cat >/dev/null'],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    let acquired = false, released = false;
    child.once('error', reject);
    child.once('exit', () => {
      if (!acquired) reject(new Error('execution-node lock unavailable'));
      else if (!released) process.exit(1); // Never serve without exclusion.
    });
    child.stdout.once('data', () => {
      acquired = true;
      resolve(() => { released = true; child.stdin.end(); });
    });
  });
}
