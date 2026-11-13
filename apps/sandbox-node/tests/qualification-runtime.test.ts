import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { qualificationFailureInventory, qualificationReadyScript, waitForQualificationPort } from '../src/qualification-runtime';
import { boundedRuntimeOutput, qualificationDiagnostics } from '../src/qualification-diagnostics';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFileSync: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe('qualification runtime observation', () => {
  it.each(['success', 'exit', 'error', 'abort', 'timeout'])('should bound and reap the internal readiness helper (%s)', async mode => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), stdout: new PassThrough(), stderr: new PassThrough() });
    vi.mocked(spawn).mockReturnValue(child as never);
    const controller = new AbortController(), diagnostic = vi.fn();
    const pending = waitForQualificationPort('uid', controller.signal, diagnostic);
    const result = mode === 'success' ? expect(pending).resolves.toBeUndefined() : expect(pending).rejects.toThrow();
    expect(spawn).toHaveBeenCalledWith('runsc', expect.arrayContaining(['exec', 'sandbox-uid', '/usr/local/bin/node']), expect.any(Object));
    if (mode === 'abort') controller.abort(new Error('cancelled'));
    else if (mode === 'timeout') await vi.advanceTimersByTimeAsync(5000);
    else if (mode === 'error') child.emit('error', new Error('spawn failed'));
    else child.emit('exit', mode === 'success' ? 0 : 1, null);
    await result;
    if (['abort', 'timeout'].includes(mode)) expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['success', 'deadline'])('should retry refused accepts inside the sandbox until %s', mode => {
    vi.useFakeTimers();
    const sockets: EventEmitter[] = [], exits: number[] = [];
    const connect = vi.fn(() => { const socket = Object.assign(new EventEmitter(), { setTimeout() {}, destroy() {} }); sockets.push(socket); return socket; });
    runInNewContext(qualificationReadyScript, { require: (name: string) => name === 'os' ? { networkInterfaces: () => ({ lo: [] }) } : { connect },
      Date, setTimeout, console: { log() {} }, process: { exit: (code: number) => { exits.push(code); throw new Error(`exit ${code}`); } } });
    expect(connect).toHaveBeenCalledWith(5173, '127.0.0.1');
    sockets[0]!.emit('error', new Error('refused')); sockets[0]!.emit('close');
    vi.advanceTimersByTime(25); expect(connect).toHaveBeenCalledTimes(2);
    if (mode === 'success') expect(() => sockets[1]!.emit('connect')).toThrow('exit 0');
    else {
      vi.advanceTimersByTime(4500);
      expect(() => sockets[1]!.emit('close')).toThrow('exit 1');
    }
    expect(exits).toEqual([mode === 'success' ? 0 : 1]);
  });
  it('should cap output bytes and select safe state fields before cleanup', () => {
    const output: string[] = [], diagnostic = qualificationDiagnostics(line => output.push(line));
    const stream = new PassThrough(); boundedRuntimeOutput(stream, 'stderr', diagnostic);
    stream.write(Buffer.alloc(8000, 65)); stream.write('ignored');
    expect(output).toHaveLength(1); expect(output[0]!.split('stderr: ')[1]).toHaveLength(4096);
    vi.mocked(execFileSync).mockImplementation(file => file === 'runsc'
      ? JSON.stringify({ id: 'uid', status: 'running', pid: 42, env: ['PRIVATE'], annotations: { private: 'PRIVATE' } })
      : 'ActiveState=failed\nResult=oom-kill\n');
    qualificationFailureInventory('uid', diagnostic);
    expect(output.join('\n')).not.toContain('PRIVATE');
    expect(output.join('\n')).toContain('Result=oom-kill');
    expect(output.every((line, index) => line.startsWith(`STEP ${index + 1} `))).toBe(true);
    for (const call of vi.mocked(execFileSync).mock.calls) expect(call[2]).toMatchObject({ timeout: 1000, killSignal: 'SIGKILL' });
  });
  it('should refuse an external interface before attempting readiness', () => {
    const connect = vi.fn();
    expect(() => runInNewContext(qualificationReadyScript, {
      require: (name: string) => name === 'os' ? { networkInterfaces: () => ({ lo: [], eth0: [] }) } : { connect },
      Date, process: { exit: (code: number) => { throw new Error(`exit ${code}`); } },
    })).toThrow('exit 2');
    expect(connect).not.toHaveBeenCalled();
  });
});
