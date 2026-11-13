import { describe, expect, it, vi } from 'vitest';
import { chownSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualificationNode } from '../src/data-plane-qualification-node.js';
import { FakeRuntimeAdapter, type RunSandboxOptions } from '../src/runtime-adapter.js';
import { prepareBundle, destroyBundle } from '../src/bundle.js';

// The OCI owner is fixed at 1000:1000; the test runner need not own that identity.
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), chownSync: vi.fn() }));

describe('qualification session spec', () => {
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
      expect(options).toMatchObject({ uid: 1000, gid: 1000, command: ['/usr/local/bin/node', '-e', expect.any(String)] });
      expect(options!.overlayUpper.startsWith(directory + '/')).toBe(true);
      expect(options!.mounts.every(mount => mount.source.startsWith(directory + '/'))).toBe(true);
      const bundle = prepareBundle(options!, () => {});
      try {
        expect(chownSync).toHaveBeenCalledExactlyOnceWith(bundle.output, 1000, 1000);
        expect(statSync(bundle.path).mode & 0o777).toBe(0o700);
        expect(statSync(join(bundle.path, 'writable/upper')).mode & 0o777).toBe(0o755);
        expect(statSync(join(bundle.workspace, 'ui')).mode & 0o777).toBe(0o755);
        expect(statSync(bundle.output).mode & 0o777).toBe(0o700);
        const spec = JSON.parse(readFileSync(join(bundle.path, 'config.json'), 'utf8'));
        expect(spec.process).toMatchObject({ args: box.command, cwd: '/workspace', user: { uid: 1000, gid: 1000 } });
        expect(spec.process.env).toContain('HOME=/tmp');
        expect(box.command[2]).toContain("s.listen(5173,'0.0.0.0')");
        expect(box.command[2]).toContain("s.on('upgrade'");
      } finally { destroyBundle(bundle, () => {}); }
      await fixture.lifecycle();
      expect(box.state).toBe('destroyed');
    } finally { process.umask(previousMask); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
