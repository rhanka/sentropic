import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { createServer } from 'node:http';
import { streamHelper } from './stream-helper';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forwardSandboxPort } from '../src/port-forward';

describe('runsc stream-mode forwarding', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
  it.each(['none', 'sandbox'] as const)('should reproduce gVisor %s FD donation with an exiting helper process', async network => {
    const directory = mkdtempSync(join(tmpdir(), 'donate-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const sockets = new Set<Socket>(); cleanup.push(() => sockets.forEach(socket => socket.destroy()));
    const upstream = createServer((_req, res) => { res.writeHead(200); res.write('stream-alive'); });
    upstream.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => upstream.listen(join(directory, 'app'), resolve)); cleanup.push(() => upstream.close());
    const events: string[] = [];
    const forward = forwardSandboxPort('runsc', '--root=/private', 'uid', 5173, join(directory, 'port'),
      streamHelper(network, join(directory, 'app'), sockets), (step, detail) => events.push(`${step}: ${detail}`));
    cleanup.push(() => forward.stop()); const target = await forward.ready;
    const first = new Promise<string>((resolve, reject) => {
      const req = request({ ...target, agent: false }, res => {
        res.once('data', bytes => { resolve(bytes.toString()); res.destroy(); });
      }); req.once('error', reject); req.end();
    });
    if (network === 'none') {
      await expect(first).rejects.toThrow('socket hang up');
      expect(events.some(event => event.includes('unsupported network type'))).toBe(true);
    } else { expect(await first).toBe('stream-alive'); }
  });
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
