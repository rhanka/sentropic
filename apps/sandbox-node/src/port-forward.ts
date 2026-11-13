import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';

/** gVisor forwards only the sandbox loopback port through a host-private UDS.
 * No host TCP listener, bridge, network namespace or sandbox egress is enabled.
 */
export function forwardSandboxPort(binary: string, rootArg: string, uid: string, port: number, socketPath: string) {
  const child = spawn(binary, [rootArg, 'port-forward', `--uds=${socketPath}`, `sandbox-${uid}`, String(port)], { stdio: 'ignore' });
  let stopped = false;
  const ready = new Promise<{ socketPath: string }>((resolve, reject) => {
    const deadline = Date.now() + 1000; let timer: ReturnType<typeof setTimeout>;
    const fail = () => { stopped = true; clearTimeout(timer); child.kill(); reject(new Error('sandbox_port_unavailable')); };
    child.once('error', fail); child.once('exit', fail);
    const poll = () => {
      if (stopped) return;
      try { if (lstatSync(socketPath).isSocket()) { resolve({ socketPath }); return; } } catch { /* not ready */ }
      if (Date.now() >= deadline) { fail(); return; }
      timer = setTimeout(poll, 10);
    };
    poll();
  });
  return { ready, stop() { stopped = true; child.kill(); } };
}
