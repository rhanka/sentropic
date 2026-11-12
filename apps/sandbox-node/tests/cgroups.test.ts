import { describe, expect, it } from 'vitest';
import { SandboxCgroup } from '../src/cgroups.js';

describe('resolved systemd scope termination', () => {
  it('should kill only the resolved sandbox scope and wait for populated zero', async () => {
    const writes: string[] = [];
    const scope = 'builder-sbx-123.scope';
    const group = `/builder.slice/builder-tenant.slice/builder-tenant-immo.slice/${scope}`;
    const cgroup = new SandboxCgroup({ controlGroup: () => group, read: () => 'populated 0\n', write: path => { writes.push(path); } });
    expect(await cgroup.stop(scope, 'immo')).toBe(true);
    expect(writes).toEqual([`/sys/fs/cgroup${group}/cgroup.kill`]);
  });

  it('should reject a foreign scope without writing and return pending for populated one', async () => {
    let writes = 0;
    const cgroup = new SandboxCgroup({ controlGroup: () => '/builder.slice/foreign.scope', read: () => '', write: () => { writes++; } });
    await expect(cgroup.stop('builder-sbx-123.scope', 'immo')).rejects.toMatchObject({ status: 500 });
    expect(writes).toBe(0);
    const pending = new SandboxCgroup({
      controlGroup: () => '/builder.slice/builder-tenant.slice/builder-tenant-immo.slice/builder-sbx-123.scope',
      read: () => 'populated 1\n', write: () => {},
    });
    expect(await pending.stop('builder-sbx-123.scope', 'immo', 0)).toBe(false);
  });
});
