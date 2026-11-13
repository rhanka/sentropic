import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { isolationProbe, requireIsolationResults } from '../src/isolation-probe.js';
import { qualifyIsolation } from '../src/isolation-qualification.js';

describe('isolation qualification probes', () => {
  it('should refuse a host without the explicit isolated guard', async () => {
    const previous = process.env.QUALIFICATION_ONLY;
    delete process.env.QUALIFICATION_ONLY;
    try { await expect(qualifyIsolation()).rejects.toThrow('isolated qualification host required'); }
    finally { if (previous !== undefined) process.env.QUALIFICATION_ONLY = previous; }
  });
  it.each(['isolated', 'leak', 'visible-directory', 'writable', 'network', 'timeout'])('should report observed access and network failures (%s)', async mode => {
    let output = '';
    const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
    // Even a non-listable directory can contain a readable/writable known file.
    const fs = { readdirSync: mode === 'visible-directory' ? () => [] : missing, accessSync: missing,
      openSync: mode === 'leak' ? () => 3 : missing, closeSync: vi.fn(),
      readFileSync: (path: string) => {
        if (path.startsWith('/other') && mode !== 'leak') return missing();
        return 'isolation fixture';
      }, writeFileSync: () => {
        if (mode !== 'writable') throw Object.assign(new Error('read only'), { errno: -30, code: 'UNKNOWN' });
      } };
    const net = { connect: () => {
      const socket = Object.assign(new EventEmitter(), { destroy() {}, setTimeout(_delay: number, callback: () => void) {
        if (mode === 'timeout') queueMicrotask(callback);
      } });
      if (mode !== 'timeout') queueMicrotask(() => socket.emit(mode === 'network' ? 'connect' : 'error', new Error('unreachable')));
      return socket;
    } };
    const modules = { 'node:fs': fs, 'node:net': net, 'node:os': { networkInterfaces: () => ({ lo: [] }) } };
    await runInNewContext(isolationProbe([{ path: '/other', directory: true }]), {
      require: (name: keyof typeof modules) => modules[name], process: { stdout: { write: (value: string) => { output = value; } } },
    });
    const checks: Array<{ name: string; ok: boolean }> = [];
    requireIsolationResults(output, (name, ok) => checks.push({ name, ok }));
    expect(checks).toHaveLength(11);
    expect(checks.every(check => check.ok)).toBe(mode === 'isolated');
    if (mode === 'leak') expect(checks.filter(check => check.name.startsWith('zero')).every(check => !check.ok)).toBe(true);
  });
  it('should fail closed for absent or malformed probe results', () => {
    for (const text of ['null', '[]', '{}', 'garbage', '[{}]', '[{"name":"check","ok":1}]']) {
      expect(() => requireIsolationResults(text, vi.fn())).toThrow();
    }
    expect(() => requireIsolationResults('[{"name":"check","ok":true}]', vi.fn(), 23)).toThrow('incomplete');
    expect(() => requireIsolationResults('[{"name":"check","ok":true},{"name":"check","ok":true}]', vi.fn())).toThrow('duplicate');
  });
});
