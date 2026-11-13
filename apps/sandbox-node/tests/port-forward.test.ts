import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forwardSandboxPort } from '../src/port-forward';

describe('runsc stream-mode forwarding', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
  it('should donate a distinct UDS for every connection and keep streams after runsc exits successfully', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'node-ports-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const peers: Socket[] = []; cleanup.push(() => peers.forEach(peer => peer.destroy()));
    const launch = vi.fn((_binary: string, args: string[]) => {
      const path = args.find(arg => arg.startsWith('--stream='))!.slice('--stream='.length);
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
      const peer = connect(path); peers.push(peer);
      peer.once('connect', () => child.emit('exit', 0));
      peer.once('data', bytes => {
        const body = bytes.toString().split(' ')[1]!;
        peer.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
      });
      return child as unknown as ChildProcess;
    });
    const forward = forwardSandboxPort('runsc', '--root=/private', 'physical-uid', 5173, join(directory, '5173.sock'), launch);
    cleanup.push(() => forward.stop()); const target = await forward.ready;
    const get = (path: string) => new Promise<string>((resolve, reject) => {
      const req = request({ ...target, path, agent: false }, res => {
        let body = ''; res.on('data', bytes => { body += bytes; }); res.once('end', () => resolve(body));
      }); req.once('error', reject); req.end();
    });
    expect(await Promise.all([get('/first'), get('/second')])).toEqual(['/first', '/second']);
    expect(launch).toHaveBeenCalledTimes(2);
    const argv = launch.mock.calls.map(call => call[1]);
    expect(argv.every(args => args[0] === '--root=/private' && args[1] === 'port-forward'
      && args[3] === 'sandbox-physical-uid' && args[4] === '5173')).toBe(true);
    expect(argv[0]![2]).not.toBe(argv[1]![2]);
  });
});
