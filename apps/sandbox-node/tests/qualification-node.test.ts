import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { chownSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualificationNode } from '../src/data-plane-qualification-node.js';
import { FakeRuntimeAdapter, RunscRuntimeAdapter, type RunSandboxOptions } from '../src/runtime-adapter.js';
import { prepareBundle, destroyBundle } from '../src/bundle.js';

// The OCI owner is fixed at 1000:1000; the test runner need not own that identity.
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), chownSync: vi.fn() }));

describe('qualification session spec', () => {
  it('should clean copied fixtures after prepareBundle fails before runtime registration, twice', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qualification-failure-'));
    writeFileSync(join(directory, 'rootfs.erofs'), 'root');
    writeFileSync(join(directory, 'qualification.erofs'), 'source');
    const adapter = new RunscRuntimeAdapter();
    const binary = vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    const capacity = vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 0n, bsize: 4096n, ffree: 4096n } as never);
    const fixture = qualificationNode(directory, directory, adapter);
    try {
      await expect(fixture.start()).rejects.toThrow();
      expect(capacity).toHaveBeenCalledWith(expect.stringContaining('/sandboxes/'), { bigint: true });
      await expect(fixture.close()).resolves.toBeUndefined();
      await expect(fixture.close()).resolves.toBeUndefined();
      expect(fs.readdirSync(join(directory, 'tenants/sentropic/sandboxes'))).toEqual([]);
      expect(fs.readdirSync(join(directory, 'tenants/sentropic/bases/source'))).toEqual([]);
    } finally { capacity.mockRestore(); binary.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('should generate a UID 1000 HTTP/WS command with private bases and a traversable output parent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qualification-spec-'));
    let options: RunSandboxOptions | undefined;
    class Runtime extends FakeRuntimeAdapter {
      override async runSandbox(input: RunSandboxOptions) { options = input; return super.runSandbox(input); }
    }
    writeFileSync(join(directory, 'rootfs.erofs'), 'root');
    writeFileSync(join(directory, 'qualification.erofs'), 'source');
    const fixture = qualificationNode(directory, directory, new Runtime());
    const previousMask = process.umask(0o077);
    try {
      const box = await fixture.start();
      expect(box.network).toBe('ports');
      expect(options!.network).toBe('ports');
      expect(options).toMatchObject({ uid: 1000, gid: 1000, command: ['/usr/local/bin/node', '-e', expect.any(String)] });
      expect(options).toMatchObject({ diskQuotaMiB: 16, quotaInodes: 1024 });
      expect(options!.overlayUpper.startsWith(directory + '/')).toBe(true);
      expect(options!.mounts.every(mount => mount.source.startsWith(directory + '/'))).toBe(true);
      const commands: Array<[string, string[]]> = [];
      const capacity = vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 384n, bsize: 1048576n, ffree: 4096n } as never);
      let bundle: ReturnType<typeof prepareBundle>;
      try { bundle = prepareBundle(options!, (command, args) => { commands.push([command, args]); }); }
      finally { capacity.mockRestore(); }
      expect(commands).toContainEqual(['truncate', ['-s', '81M', join(bundle.path, 'writable.ext4')]]);
      try {
        expect(chownSync).toHaveBeenCalledExactlyOnceWith(bundle.output, 1000, 1000);
        expect(statSync(bundle.path).mode & 0o777).toBe(0o700);
        expect(statSync(join(bundle.path, 'writable/upper')).mode & 0o777).toBe(0o755);
        expect(statSync(join(bundle.workspace, 'ui')).mode & 0o777).toBe(0o755);
        expect(statSync(bundle.output).mode & 0o777).toBe(0o700);
        const spec = JSON.parse(readFileSync(join(bundle.path, 'config.json'), 'utf8'));
        expect(spec.process).toMatchObject({ args: box.command, cwd: '/workspace', user: { uid: 1000, gid: 1000 } });
        expect(spec.process.env).toContain('HOME=/tmp');
        expect(spec.linux.namespaces.find((ns: { type: string }) => ns.type === 'network'))
          .toEqual({ type: 'network', path: '/proc/self/ns/net' });
        expect(box.command[2]).toContain("s.listen(5173,'0.0.0.0')");
        expect(box.command[2]).toContain("s.on('upgrade'");
      } finally { destroyBundle(bundle, () => {}); }
      await fixture.lifecycle();
      expect(box.state).toBe('destroyed');
    } finally { process.umask(previousMask); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
