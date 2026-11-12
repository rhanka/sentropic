import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ExecutionNodeError } from './errors.js';

export interface CgroupIO {
  controlGroup(scope: string): string;
  read(path: string): string;
  write(path: string, value: string): void;
}
const host: CgroupIO = {
  controlGroup: scope => execFileSync('systemctl', ['show', scope, '--property=ControlGroup', '--value'], { encoding: 'utf8' }).trim(),
  read: path => readFileSync(path, 'utf8'),
  write: (path, value) => writeFileSync(path, value),
};

export class SandboxCgroup {
  constructor(private readonly io: CgroupIO = host) {}

  resolve(scope: string, tenantId: string): string {
    const group = this.io.controlGroup(scope);
    const parent = `/builder.slice/builder-tenant.slice/builder-tenant-${tenantId}.slice/`;
    if (!/^builder-sbx-[a-zA-Z0-9-]+\.scope$/.test(scope)
      || !['sentropic', 'immo'].includes(tenantId) || group !== `${parent}${scope}`) {
      throw new ExecutionNodeError('cgroup_tenant_mismatch', 'systemd scope outside expected tenant');
    }
    return `/sys/fs/cgroup${group}`;
  }

  async stop(scope: string, tenantId: string, timeoutMs = 5000): Promise<boolean> {
    const group = this.resolve(scope, tenantId);
    this.io.write(`${group}/cgroup.kill`, '1');
    const deadline = Date.now() + timeoutMs;
    do {
      if (/^populated 0$/m.test(this.io.read(`${group}/cgroup.events`))) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (true);
  }
}
