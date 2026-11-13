import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { qualificationStorage } from './qualification-storage.js';

/** Read-only: an operator must reconcile interrupted runs before granting another run. */
export function assertNoQualificationLeftovers(release: string, runtime = '/run/execution-node', tenants = '/var/lib/builder/tenants', storage = qualificationStorage): void {
  const list = (path: string) => existsSync(path) ? readdirSync(path) : [];
  const leftovers = list(runtime).filter(name => /^(qd-|qi-)/.test(name)).map(name => join(runtime, name));
  leftovers.push(...list(storage).filter(name => /^(qd-|qi-)/.test(name)).map(name => join(storage, name)));
  leftovers.push(...list(join(runtime, 'ports')).map(name => join(runtime, 'ports', name)));
  const digest = createHash('sha256').update(readFileSync(join(release, 'qualification.erofs'))).digest('hex');
  for (const tenant of ['sentropic', 'immo']) {
    const bases = join(tenants, tenant, 'bases');
    leftovers.push(...list(bases).filter(name => name.startsWith('qual-isolation-')).map(name => join(bases, name)));
    const copied = join(bases, 'source', `${digest}.erofs`);
    if (existsSync(copied)) leftovers.push(copied);
    // Reported by k8s after the killed a7037db7 qualification; a rebuilt image may hash differently.
    leftovers.push(...list(join(bases, 'source')).filter(name => /^caf46fda[a-f0-9]{56}\.erofs$/.test(name))
      .map(name => join(bases, 'source', name)));
  }
  if (leftovers.length) {
    console.error(`Qualification leftovers: ${leftovers.join(', ')}. Stop the service, reconcile scopes/runsc/mounts, then remove these exact paths (OPERATOR.md).`);
    throw new Error('qualification leftovers require operator reconciliation');
  }
}
