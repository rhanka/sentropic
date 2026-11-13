import { spawn } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';

/** The test process acts as sentry, retaining the donated socket after helper exit. */
export function streamHelper(network: 'none' | 'sandbox', upstream: string, sockets: Set<Duplex>) {
  return (_binary: string, args: string[]) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/runsc-stream.mjs', import.meta.url)), ...args],
      { env: { ...process.env, FAKE_RUNSC_NETWORK: network }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.on('message', (_message, donated) => {
      const stream = donated as Socket, target = connect(upstream);
      for (const socket of [stream, target]) { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }
      const close = () => { stream.destroy(); target.destroy(); };
      stream.on('error', close); target.on('error', close);
      stream.once('close', close); target.once('close', close);
      stream.pipe(target).pipe(stream); stream.resume();
    });
    return child;
  };
}
