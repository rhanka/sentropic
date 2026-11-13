import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, chownSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunSandboxOptions } from './runtime-adapter.js';
import { assertUnlinkedPath } from './mounts.js';
import { mountQuotaVolume } from './disk-quota.js';
import { throwFilesystemError } from './filesystem-errors.js';

export type HostCommand = (command: string, args: string[]) => void;
const host: HostCommand = (command, args) => { execFileSync(command, args, { stdio: 'pipe', timeout: 5000 }); };
export interface Bundle { path: string; workspace: string; output: string; mounted: string[] }

/** Only the agent writes source. Untrusted processes see a read-only workspace. */
export function prepareBundle(options: RunSandboxOptions, run: HostCommand = host): Bundle {
  const path = dirname(options.overlayUpper);
  const bundle: Bundle = { path, workspace: join(path, 'workspace'), output: join(path, 'output'), mounted: [] };
  const root = options.mounts.find(mount => mount.target.startsWith('/bases/rootfs/'));
  const source = options.mounts.find(mount => mount.target.startsWith('/bases/source/'));
  if (!root || !source) throw new Error('rootfs and source bases required');
  if (!options.command?.length || !options.command[0]!.startsWith('/')) throw new Error('absolute session command required');
  const rootfs = join(path, 'rootfs'), lower = join(path, 'source');
  const mkdir = (dir: string) => mkdirSync(dir, { recursive: true, mode: 0o700 });
  const mountImage = (image: string, target: string) => {
    mkdir(target); run('mount', ['-t', 'erofs', '-o', 'loop,ro,nosuid,nodev', image, target]); bundle.mounted.push(target);
  };
  try {
    mkdir(path);
    const volume = mountQuotaVolume(bundle, options.diskQuotaMiB, options.quotaInodes, run);
    const upper = join(volume, 'upper'), work = join(volume, 'work');
    bundle.output = join(volume, 'output');
    mkdir(upper); mkdir(work); mkdir(bundle.workspace); mkdir(bundle.output);
    // Overlay root permissions come from upper; the sandbox uid must traverse its cwd.
    // The enclosing host bundle stays 0700 and the OCI workspace bind stays read-only.
    chmodSync(upper, 0o755);
    mountImage(root.source, rootfs); mountImage(source.source, lower);
    run('mount', ['-t', 'overlay', 'overlay', '-o', `lowerdir=${lower},upperdir=${upper},workdir=${work}`, bundle.workspace]);
    bundle.mounted.push(bundle.workspace);
    const mounts: Array<{ destination: string; type: string; source: string; options: string[] }> = [
      { destination: '/proc', type: 'proc', source: 'proc', options: ['nosuid', 'nodev', 'noexec'] },
      { destination: '/tmp', type: 'tmpfs', source: 'tmpfs', options: ['nosuid', 'nodev', 'size=128m', 'mode=1777'] },
      { destination: '/dev', type: 'tmpfs', source: 'tmpfs', options: ['nosuid', 'mode=755', 'size=1m'] },
      { destination: '/workspace', type: 'bind', source: bundle.workspace, options: ['rbind', 'ro', 'nosuid', 'nodev'] },
    ];
    for (const mount of options.mounts.filter(item => !item.target.startsWith('/bases/rootfs/') && !item.target.startsWith('/bases/source/'))) {
      const kind = mount.target.split('/')[2];
      const target = join(path, `base-${kind}`); mountImage(mount.source, target);
      const destination = kind === 'dependencies' ? '/workspace/node_modules' : kind === 'prebundle' ? '/workspace/node_modules/.vite' : `/bases/${kind}`;
      mounts.push({ destination, type: 'bind', source: target, options: ['rbind', 'ro', 'nosuid', 'nodev'] });
    }
    if (options.quotaMiB > 704) {
      assertUnlinkedPath(bundle.workspace, 'ui/dist');
      mkdir(join(bundle.workspace, 'ui/dist')); chownSync(bundle.output, options.uid, options.gid);
      mounts.push({ destination: '/workspace/ui/dist', type: 'bind', source: bundle.output, options: ['rbind', 'rw', 'nosuid', 'nodev', 'noexec'] });
    }
    writeFileSync(join(path, 'config.json'), JSON.stringify({ ociVersion: '1.0.2',
      root: { path: rootfs, readonly: true }, hostname: 'sandbox', mounts,
      process: { terminal: false, user: { uid: options.uid, gid: options.gid }, args: options.command,
        env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', 'TMPDIR=/tmp'], cwd: '/workspace', noNewPrivileges: true,
        capabilities: { bounding: [], effective: [], inheritable: [], permitted: [], ambient: [] },
        rlimits: [{ type: 'RLIMIT_NOFILE', hard: 4096, soft: 4096 }] },
      linux: { namespaces: ['pid', 'ipc', 'uts', 'mount', 'network'].map(type => ({ type })),
        resources: { memory: { limit: options.quotaMiB * 1048576 }, pids: { limit: options.quotaMiB > 704 ? 1024 : 512 } },
        devices: [{ path: '/dev/null', type: 'c', major: 1, minor: 3, fileMode: 438, uid: 0, gid: 0 },
          { path: '/dev/urandom', type: 'c', major: 1, minor: 9, fileMode: 438, uid: 0, gid: 0 }] },
    }), { mode: 0o600 });
    return bundle;
  } catch (error) { destroyBundle(bundle, run); throwFilesystemError(error); }
}

export function destroyBundle(bundle: Bundle, run: HostCommand = host): void {
  while (bundle.mounted.length) {
    run('umount', [bundle.mounted[bundle.mounted.length - 1]!]); bundle.mounted.pop();
  }
  rmSync(bundle.path, { recursive: true, force: true });
}
