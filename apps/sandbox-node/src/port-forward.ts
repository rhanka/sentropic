import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { boundedRuntimeOutput, type RuntimeDiagnostic } from './qualification-diagnostics.js';

/** runsc --stream connects once to a listening UDS and donates that connection
 * to the sentry. A private local relay creates one donation per HTTP/WS socket.
 * No host TCP listener or sandbox egress is enabled.
 */
export function forwardSandboxPort(binary: string, rootArg: string, uid: string, port: number, socketPath: string,
  launch: (binary: string, args: string[]) => ChildProcess = (command, args) => spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] }),
  diagnostic?: RuntimeDiagnostic) {
  const sockets = new Set<Socket>(); const children = new Set<ChildProcess>();
  const bridges = new Set<ReturnType<typeof createServer>>();
  let stopped = false; let sequence = 0;
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  const server = createServer(local => {
    diagnostic?.('UDS connect', `accepted port=${port}`);
    sockets.add(local); local.pause();
    const streamPath = `${socketPath}.${++sequence}`;
    let child: ChildProcess | undefined; let timer: ReturnType<typeof setTimeout>; let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      clearTimeout(timer); local.destroy(); child?.kill('SIGKILL'); if (bridge.listening) bridge.close(); bridges.delete(bridge);
    };
    const bridge = createServer(remote => {
      diagnostic?.('port-forward donation', `connected stream=${sequence}`);
      clearTimeout(timer); sockets.add(remote); bridge.close(); bridges.delete(bridge);
      remote.once('close', () => { sockets.delete(remote); local.destroy(); });
      remote.on('error', close); local.once('close', () => remote.destroy());
      remote.once('data', () => diagnostic?.('5173 first byte', `stream=${sequence}`));
      local.pipe(remote).pipe(local); local.resume();
    });
    bridge.maxConnections = 1;
    bridges.add(bridge); bridge.once('error', close); local.on('error', close);
    local.once('close', () => { sockets.delete(local); close(); });
    bridge.listen(streamPath, () => {
      if (stopped || local.destroyed) { close(); return; }
      try {
        child = launch(binary, [rootArg, 'port-forward', `--stream=${streamPath}`, `sandbox-${uid}`, String(port)]);
        diagnostic?.('port-forward spawn', `port=${port} stream=${sequence}`);
        boundedRuntimeOutput(child.stderr, 'port-forward stderr', diagnostic);
        children.add(child); child.once('error', close);
        child.once('exit', (code, signal) => {
          diagnostic?.('port-forward exit', `code=${code} signal=${signal ?? 'none'}`);
          children.delete(child!); if (code !== 0) close();
        });
        timer = setTimeout(close, 1000); timer.unref();
      } catch { close(); }
    });
  });
  const ready = new Promise<{ socketPath: string }>((resolve, reject) => {
    server.once('error', () => reject(new Error('sandbox_port_unavailable')));
    server.listen(socketPath, () => resolve({ socketPath }));
  });
  return { ready, stop() {
    stopped = true; server.close(); for (const bridge of bridges) bridge.close();
    for (const socket of sockets) socket.destroy(); for (const child of children) child.kill('SIGKILL');
  } };
}
