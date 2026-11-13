import { describe, expect, it, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { RunscRuntimeAdapter, type RunSandboxOptions } from '../src/runtime-adapter.js';
import { qualifyIsolation } from '../src/isolation-qualification.js';
import { acquireNodeLock } from '../src/node-lock.js';

vi.mock('../src/node-lock.js', () => ({ acquireNodeLock: vi.fn() }));
vi.mock('../src/qualification-prerequisites.js', () => ({ qualificationPrerequisites: vi.fn() }));
vi.mock('../src/qualification-processes.js', () => ({ qualificationProcesses: () => ({ pids: ['123'], namespaces: ['net:[123]'] }), assertQualificationProcessesGone: vi.fn() }));
vi.mock('../src/qualification-runtime.js', () => ({ waitForQualificationPort: vi.fn() }));
vi.mock('../src/qualification-network.js', async original => ({ ...await original<typeof import('../src/qualification-network.js')>(),
  qualificationHostAddresses: () => ['15.235.44.193'], hostNetworkWitnesses: async () => ({ close: async () => {} }) }));
vi.mock('../src/qualification-storage.js', async original => ({ ...await original<typeof import('../src/qualification-storage.js')>(),
  createQualificationDirectory: () => fs.mkdtempSync('/var/lib/builder/qualification/qi-') }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFileSync: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original<typeof fs>(), existsSync: vi.fn(), mkdtempSync: vi.fn(), mkdirSync: vi.fn(),
  copyFileSync: vi.fn(), readdirSync: vi.fn(), chmodSync: vi.fn(), writeFileSync: vi.fn(), rmSync: vi.fn(), readFileSync: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe('real-host qualification orchestration', () => {
  it.each(['pass', 'launch-failure', 'probe-failure', 'scope-failure', 'mount-leak', 'interrupt'])
    ('should clean only its own resources and reject failed checks (%s)', async mode => {
      vi.stubEnv('QUALIFICATION_ONLY', 'isolated');
      const release = vi.fn();
      vi.mocked(acquireNodeLock).mockResolvedValue(release);
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      vi.spyOn(process, 'getuid').mockReturnValue(0);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const paths = new Set<string>(), launched: RunSandboxOptions[] = [], cleaned: string[] = [];
      let marker = true;
      let sequence = 0;
      vi.mocked(fs.existsSync).mockImplementation(path => (path === '/etc/execution-node/isolated-qualification' && marker) || paths.has(String(path)));
      vi.mocked(fs.mkdtempSync).mockImplementation(prefix => { const path = `${prefix}fixture${sequence++ || ''}`; paths.add(path); return path; });
      vi.mocked(fs.rmSync).mockImplementation(path => {
        if (path !== '/etc/execution-node/isolated-qualification') cleaned.push(String(path));
        else marker = false;
        paths.delete(String(path));
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => mode === 'mount-leak' && launched.length > 0
        ? `1 0 0:1 / ${launched[0]!.overlayUpper.replace(/\/upper$/, '')}/writable rw - ext4 /dev/loop9 rw` : '');
      vi.spyOn(RunscRuntimeAdapter.prototype, 'runSandbox').mockImplementation(async (options: RunSandboxOptions) => {
          launched.push(options); paths.add(options.overlayUpper.replace(/\/upper$/, ''));
          if (mode === 'interrupt') process.emit('SIGTERM');
          if (mode === 'launch-failure' && launched.length === 2) throw new Error('launcher failed');
          return { runtimeId: `runsc-${options.tenantId}-${options.sandboxUid}` };
      });
      vi.spyOn(RunscRuntimeAdapter.prototype, 'destroySandbox').mockImplementation(async (runtimeId: string) => {
          const options = launched.find(option => runtimeId === `runsc-${option.tenantId}-${option.sandboxUid}`)!;
          expect(options).toBeDefined();
          cleaned.push(options.overlayUpper.replace(/\/upper$/, '')); paths.delete(options.overlayUpper.replace(/\/upper$/, ''));
      });
      vi.mocked(execFileSync).mockImplementation((file, args) => {
        if (file === 'findmnt') return '/dev/loop0';
        if (file === 'losetup') return '/var/lib/builder/tenant.ext4';
        if (file === 'systemctl' && args?.[1] === 'execution-node.service') return 'inactive';
        if (file === 'runsc' && args?.[1] === 'list') return 'null';
        if (file === 'runsc') return JSON.stringify(Array.from({ length: String(args?.at(-1)).includes('no default DNS') ? 13 : 23 }, (_, i) => ({ name: `probe-${i}`, ok: mode !== 'probe-failure' })));
        if (file === 'systemctl' && args?.[0] === 'list-units') return '';
        if (file === 'systemctl') {
          const tenant = launched.find(box => String(args?.[1]).includes(box.sandboxUid))!.tenantId;
          const values: Record<string, string> = { Slice: `builder-tenant-${tenant}.slice`, MemoryHigh: '738197504',
            MemoryLow: '738197504', CPUWeight: mode === 'scope-failure' ? '100' : '200', TasksMax: '512', OOMPolicy: 'kill',
            ControlGroup: `/builder.slice/builder-tenant.slice/builder-tenant-${tenant}.slice/${args?.[1]}` };
          return values[String(args?.[2]).replace('--property=', '')];
        }
        throw new Error(`unexpected command ${file}`);
      });
      if (mode === 'pass') await expect(qualifyIsolation()).resolves.toBeUndefined();
      else await expect(qualifyIsolation()).rejects.toThrow('isolation qualification failed');
      expect(launched.length).toBeGreaterThan(0);
      if (mode === 'pass') expect(launched.map(({ tenantId, network }) => [tenantId, network]))
        .toEqual([['sentropic', 'none'], ['immo', 'none'], ['sentropic', 'ports'], ['immo', 'ports']]);
      expect(release).toHaveBeenCalledOnce();
      expect(marker).toBe(false);
      if (mode === 'pass') await expect(qualifyIsolation()).rejects.toThrow('marker required');
      expect(fs.copyFileSync).toHaveBeenCalledWith(expect.stringMatching(/qualification\.erofs$/), expect.stringMatching(/source\.erofs$/));
      for (const options of launched) {
        expect(options.mounts[0]!.source).toMatch(/rootfs\.erofs$/);
        expect(options.uid).toBe(1000);
        if (mode !== 'launch-failure' || options.tenantId === 'sentropic') {
          expect(fs.writeFileSync).toHaveBeenCalledWith(options.overlayUpper.replace(/upper$/, 'isolation-marker'), 'foreign tenant sentinel', { mode: 0o666 });
        }
        expect(cleaned).toContain(options.overlayUpper.replace(/\/upper$/, ''));
      }
      expect(cleaned.every(path => path.startsWith('/var/lib/builder/qualification/qi-fixture'))).toBe(true);
      expect(fs.copyFileSync).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^\/var\/lib\/builder\/qualification\/qi-fixture\//));
      expect(launched.every(options => options.overlayUpper.startsWith('/var/lib/builder/qualification/qi-fixture/'))).toBe(true);
      if (mode === 'pass') expect(paths.size).toBe(0);
      if (mode === 'mount-leak') expect(paths.size).toBe(2); // Preserve the private root and the mounted sandbox's base.
      expect(log.mock.calls.some(([line]) => String(line).startsWith('FAIL'))).toBe(mode !== 'pass');
    });
  it.each(['service', 'lock', 'scope', 'directory', 'container', 'garbage', 'mount'])
    ('should refuse live or unprovable activity before creating anything (%s)', async mode => {
      vi.stubEnv('QUALIFICATION_ONLY', 'isolated');
      vi.spyOn(process, 'getuid').mockReturnValue(0);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const release = vi.fn();
      vi.mocked(acquireNodeLock).mockImplementation(async () => {
        if (mode === 'lock') throw new Error('locked');
        return release;
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(mode === 'directory' ? ['existing'] as never : []);
      vi.mocked(fs.readFileSync).mockReturnValue(mode === 'mount'
        ? '1 0 0:1 / /var/lib/builder/tenants/immo/sandboxes/existing/writable rw - ext4 /dev/loop9 rw' : '');
      vi.mocked(execFileSync).mockImplementation((file, args) => {
        if (file === 'runsc') return mode === 'garbage' ? '{}' : mode === 'container' ? '[{"id":"tenant"}]' : 'null';
        if (args?.[1] === 'execution-node.service') return mode === 'service' ? 'active' : 'inactive';
        return mode === 'scope' ? 'builder-sbx-existing.scope' : '';
      });
      await expect(qualifyIsolation()).rejects.toThrow();
      expect(fs.mkdtempSync).not.toHaveBeenCalled();
      expect(fs.copyFileSync).not.toHaveBeenCalled();
      expect(fs.rmSync).not.toHaveBeenCalled(); // Authorization remains unused on refusal.
      if (mode !== 'lock') expect(release).toHaveBeenCalledOnce();
    });
});
