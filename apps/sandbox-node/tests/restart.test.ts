import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCleanStartup } from '../src/restart.js';
import { nextNodeEpoch } from '../src/node-state.js';

describe('restart admission fence', () => {
  it.each(['null', '[]'])('should accept empty inventory %s and tenant lost+found', inventory => {
    const root = mkdtempSync(join(tmpdir(), 'restart-empty-'));
    try {
      for (const tenant of ['sentropic', 'immo']) mkdirSync(join(root, 'tenants', tenant, 'lost+found'), { recursive: true });
      const mountInfo = join(root, 'mountinfo'); writeFileSync(mountInfo, '');
      assertCleanStartup(root, command => command === 'systemctl' ? '' : inventory, mountInfo);
      for (const garbage of ['garbage', '{}', 'false', '0', '[null]', '[{}]']) {
        expect(() => assertCleanStartup(root, command => command === 'systemctl' ? '' : garbage, mountInfo)).toThrow();
      }
    } finally { rmSync(root, { recursive: true }); }
  });
  it.each(['scopes', 'runsc', 'directories', 'mounts', 'inventory-error'])('should refuse a fresh listener with surviving %s', kind => {
    const root = mkdtempSync(join(tmpdir(), 'restart-'));
    const listen = vi.fn();
    const ids = ['session-sentropic', 'session-immo', 'build-immo'];
    const mountInfo = join(root, 'mountinfo');
    try {
      expect(nextNodeEpoch(root)).toBe(1);
      writeFileSync(mountInfo, kind === 'mounts'
        ? `1 0 0:1 / ${root}/tenants/immo/sandboxes/build-immo/output rw - overlay overlay rw\n` : '');
      if (kind === 'directories') for (const id of ids) mkdirSync(join(root, 'tenants/immo/sandboxes', id), { recursive: true });
      const run = (command: string) => {
        if (kind === 'inventory-error') throw new Error('systemd unavailable');
        if (command === 'systemctl') return kind === 'scopes' ? ids.map(id => `builder-sbx-${id}.scope loaded active running`).join('\n') : '';
        return JSON.stringify(kind === 'runsc' ? ids.map(id => ({ id: `sandbox-${id}` })) : []);
      };
      expect(() => { assertCleanStartup(root, run, mountInfo); listen(); }).toThrow();
      expect(listen).not.toHaveBeenCalled();
      // Heartbeats cannot reopen admission because the listener never opens.
      rmSync(join(root, 'tenants'), { recursive: true, force: true }); writeFileSync(mountInfo, '');
      assertCleanStartup(root, command => command === 'systemctl' ? '' : '[]', mountInfo);
      expect(nextNodeEpoch(root)).toBe(2);
      listen(); expect(listen).toHaveBeenCalledOnce();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('should inventory before constructing fresh admission counters or listening', () => {
    const service = readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8');
    const fence = service.indexOf('assertCleanStartup();');
    expect(fence).toBeGreaterThan(0);
    expect(fence).toBeLessThan(service.indexOf('createExecutionNode({'));
    expect(fence).toBeLessThan(service.indexOf('server.listen('));
  });
});
